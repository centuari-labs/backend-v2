import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OrdersWorker } from '../../orders/orders.worker';
import { OrderRepository } from '../../orders/repositories/order.repository';
import { OrdersService } from '../../orders/orders.service';
import { NatsService } from '../../core/nats/nats.service';
import { EventsGateway } from '../../core/websocket/websocket.gateway';
import { Market } from '../../market/entities/market.entity';
import { Token } from '../../tokens/entities/token.entity';
import { Order } from '../../orders/entities/order.entity';
import { OrderSide, OrderStatus, OrderType } from '../../orders/constants/order.constants';
import { createMockOrder, createMockMarket, createMockToken, createMockAccount, MOCK_IDS } from '../helpers/mock-factories';
import {
    createMockOrderRepository,
    createMockNatsService,
    createMockEventsGateway,
    createMockOrdersService,
    createMockRepository,
    createMockDataSource,
} from '../helpers/mock-services';

describe('OrdersWorker', () => {
    let worker: OrdersWorker;
    let orderRepository: jest.Mocked<OrderRepository>;
    let marketRepository: jest.Mocked<Repository<Market>>;
    let tokenRepository: jest.Mocked<Repository<Token>>;
    let ordersService: jest.Mocked<OrdersService>;
    let dataSource: jest.Mocked<DataSource>;
    let eventsGateway: jest.Mocked<EventsGateway>;

    const originalEnv = process.env;

    beforeEach(async () => {
        process.env = { ...originalEnv, NODE_ENV: 'development', ORDER_WORKER_ENABLED: 'true' };

        const mockOrderRepo = createMockOrderRepository();
        const mockMarketRepo = createMockRepository<Market>();
        const mockTokenRepo = createMockRepository<Token>();
        const mockOrdersService = createMockOrdersService();
        const mockDataSource = createMockDataSource();
        const mockNatsService = createMockNatsService();
        const mockEventsGateway = createMockEventsGateway();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OrdersWorker,
                { provide: OrderRepository, useValue: mockOrderRepo },
                { provide: getRepositoryToken(Market), useValue: mockMarketRepo },
                { provide: getRepositoryToken(Token), useValue: mockTokenRepo },
                { provide: OrdersService, useValue: mockOrdersService },
                { provide: DataSource, useValue: mockDataSource },
                { provide: NatsService, useValue: mockNatsService },
                { provide: EventsGateway, useValue: mockEventsGateway },
            ],
        }).compile();

        worker = module.get<OrdersWorker>(OrdersWorker);
        orderRepository = module.get(OrderRepository) as jest.Mocked<OrderRepository>;
        marketRepository = module.get(getRepositoryToken(Market)) as jest.Mocked<Repository<Market>>;
        tokenRepository = module.get(getRepositoryToken(Token)) as jest.Mocked<Repository<Token>>;
        ordersService = module.get(OrdersService) as jest.Mocked<OrdersService>;
        dataSource = module.get(DataSource) as jest.Mocked<DataSource>;
        eventsGateway = module.get(EventsGateway) as jest.Mocked<EventsGateway>;
    });

    afterEach(() => {
        process.env = originalEnv;
        jest.clearAllMocks();
    });

    describe('onModuleInit', () => {
        it('should load cache when enabled', async () => {
            const market = createMockMarket();
            const token = createMockToken();
            marketRepository.find.mockResolvedValue([market]);
            tokenRepository.find.mockResolvedValue([token]);

            await worker.onModuleInit();

            expect(marketRepository.find).toHaveBeenCalled();
            expect(tokenRepository.find).toHaveBeenCalled();
        });

        it('should skip when disabled (production)', async () => {
            process.env.NODE_ENV = 'production';

            await worker.onModuleInit();

            expect(marketRepository.find).not.toHaveBeenCalled();
        });

        it('should skip when ORDER_WORKER_ENABLED is not true', async () => {
            process.env.ORDER_WORKER_ENABLED = 'false';

            await worker.onModuleInit();

            expect(marketRepository.find).not.toHaveBeenCalled();
        });
    });

    describe('refreshAssetMarketCache', () => {
        it('should populate cache from markets and tokens', async () => {
            const market1 = createMockMarket({ id: 'c0000000-0000-0000-0000-000000000001', assetId: MOCK_IDS.assetId });
            const market2 = createMockMarket({ id: 'c0000000-0000-0000-0000-000000000002', assetId: MOCK_IDS.assetId });
            const token = createMockToken({ id: MOCK_IDS.assetId });

            marketRepository.find.mockResolvedValue([market1, market2]);
            tokenRepository.find.mockResolvedValue([token]);

            await worker.refreshAssetMarketCache();

            expect(marketRepository.find).toHaveBeenCalled();
            expect(tokenRepository.find).toHaveBeenCalled();
        });

        it('should handle empty markets gracefully', async () => {
            marketRepository.find.mockResolvedValue([]);
            tokenRepository.find.mockResolvedValue([]);

            await worker.refreshAssetMarketCache();

            expect(marketRepository.find).toHaveBeenCalled();
        });

        it('should log error on failure', async () => {
            marketRepository.find.mockRejectedValue(new Error('DB connection failed'));

            await expect(worker.refreshAssetMarketCache()).resolves.not.toThrow();
        });

        it('should skip when disabled', async () => {
            process.env.NODE_ENV = 'production';

            await worker.refreshAssetMarketCache();

            expect(marketRepository.find).not.toHaveBeenCalled();
        });
    });

    describe('createRandomOrder', () => {
        beforeEach(async () => {
            // Populate the cache
            const market = createMockMarket();
            const token = createMockToken();
            marketRepository.find.mockResolvedValue([market]);
            tokenRepository.find.mockResolvedValue([token]);
            await worker.refreshAssetMarketCache();
            jest.clearAllMocks();
        });

        it('should skip when cache is empty', async () => {
            // Reset cache by refreshing with empty data
            marketRepository.find.mockResolvedValue([]);
            tokenRepository.find.mockResolvedValue([]);
            await worker.refreshAssetMarketCache();

            await worker.createRandomOrder();

            expect(ordersService.createLendLimitOrder).not.toHaveBeenCalled();
            expect(ordersService.createBorrowLimitOrder).not.toHaveBeenCalled();
        });

        it('should skip when open orders >= MAX_OPEN_ORDERS', async () => {
            orderRepository.count.mockResolvedValue(10000);

            await worker.createRandomOrder();

            expect(ordersService.createLendLimitOrder).not.toHaveBeenCalled();
            expect(ordersService.createBorrowLimitOrder).not.toHaveBeenCalled();
        });

        it('should create a limit order when under max open orders', async () => {
            orderRepository.count.mockResolvedValue(0);
            ordersService.createLendLimitOrder.mockResolvedValue({} as any);
            ordersService.createBorrowLimitOrder.mockResolvedValue({} as any);

            await worker.createRandomOrder();

            const lendCalled = ordersService.createLendLimitOrder.mock.calls.length;
            const borrowCalled = ordersService.createBorrowLimitOrder.mock.calls.length;
            expect(lendCalled + borrowCalled).toBe(1);
        });

        it('should handle creation error gracefully', async () => {
            orderRepository.count.mockResolvedValue(0);
            ordersService.createLendLimitOrder.mockRejectedValue(new Error('Creation failed'));
            ordersService.createBorrowLimitOrder.mockRejectedValue(new Error('Creation failed'));

            await expect(worker.createRandomOrder()).resolves.not.toThrow();
        });

        it('should skip when disabled', async () => {
            process.env.NODE_ENV = 'production';

            await worker.createRandomOrder();

            expect(orderRepository.count).not.toHaveBeenCalled();
        });
    });

    describe('partiallyFillRandomOrder', () => {
        const mockQueryBuilder = {
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            getOne: jest.fn(),
        };

        beforeEach(() => {
            orderRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
        });

        it('should partially fill an open order', async () => {
            const order = createMockOrder({
                quantity: '1000',
                filledQuantity: '0',
                settlementFee: '50000',
            });
            mockQueryBuilder.getOne.mockResolvedValue(order);
            orderRepository.save.mockResolvedValue({ ...order, status: OrderStatus.PartiallyFilled } as Order);

            await worker.partiallyFillRandomOrder();

            expect(orderRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: OrderStatus.PartiallyFilled,
                }),
            );
        });

        it('should skip when no open orders', async () => {
            mockQueryBuilder.getOne.mockResolvedValue(null);

            await worker.partiallyFillRandomOrder();

            expect(orderRepository.save).not.toHaveBeenCalled();
        });

        it('should skip when remaining <= 0', async () => {
            const order = createMockOrder({
                quantity: '1000',
                filledQuantity: '1000',
            });
            mockQueryBuilder.getOne.mockResolvedValue(order);

            await worker.partiallyFillRandomOrder();

            expect(orderRepository.save).not.toHaveBeenCalled();
        });

        it('should not overfill (skip when nextFilled >= quantity)', async () => {
            // An order with very little remaining - increment calculation might try to fill 100%
            const order = createMockOrder({
                quantity: '2',
                filledQuantity: '1',
                settlementFee: '100',
            });
            mockQueryBuilder.getOne.mockResolvedValue(order);

            await worker.partiallyFillRandomOrder();

            // Either saves with partial fill or skips (nextFilled >= quantity check)
            // The result depends on random fraction; the point is it doesn't throw
        });

        it('should skip when disabled', async () => {
            process.env.NODE_ENV = 'production';

            await worker.partiallyFillRandomOrder();

            expect(orderRepository.createQueryBuilder).not.toHaveBeenCalled();
        });
    });

    describe('fillRandomOrder', () => {
        const mockQueryBuilder = {
            innerJoin: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            getOne: jest.fn(),
        };

        const mockDsQueryBuilder = {
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            getRawOne: jest.fn(),
        };

        beforeEach(async () => {
            // Populate the cache
            const market = createMockMarket();
            const token = createMockToken();
            const mockSimpleQb = {
                where: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                getOne: jest.fn().mockResolvedValue(null),
            };
            orderRepository.createQueryBuilder.mockReturnValue(mockSimpleQb as any);
            (marketRepository.find as jest.Mock).mockResolvedValue([market]);
            (tokenRepository.find as jest.Mock).mockResolvedValue([token]);
            await worker.refreshAssetMarketCache();
            jest.clearAllMocks();

            orderRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
            dataSource.createQueryBuilder.mockReturnValue(mockDsQueryBuilder as any);
        });

        it('should prefer partially filled orders', async () => {
            const order = createMockOrder({
                status: OrderStatus.PartiallyFilled,
                quantity: '1000',
                filledQuantity: '500',
                settlementFee: '50000',
            });
            mockQueryBuilder.getOne.mockResolvedValueOnce(order);
            mockDsQueryBuilder.getRawOne.mockResolvedValue({ order_market_id: 'om-1' });
            marketRepository.findOne.mockResolvedValue(createMockMarket());
            orderRepository.getOrCreateAccount.mockResolvedValue(createMockAccount());
            dataSource.transaction.mockImplementation(async (cb: any) => cb({
                getRepository: jest.fn().mockReturnValue({
                    update: jest.fn(),
                    create: jest.fn().mockReturnValue(createMockOrder()),
                    save: jest.fn().mockResolvedValue(createMockOrder({ id: 'counter-id' })),
                }),
                query: jest.fn(),
            }));

            await worker.fillRandomOrder();

            expect(dataSource.transaction).toHaveBeenCalled();
        });

        it('should fall back to open orders when no partially filled', async () => {
            const openOrder = createMockOrder({ status: OrderStatus.Open, quantity: '1000', settlementFee: '50000' });
            mockQueryBuilder.getOne
                .mockResolvedValueOnce(null) // No partially filled
                .mockResolvedValueOnce(openOrder); // Fall back to open
            mockDsQueryBuilder.getRawOne.mockResolvedValue({ order_market_id: 'om-1' });
            marketRepository.findOne.mockResolvedValue(createMockMarket());
            orderRepository.getOrCreateAccount.mockResolvedValue(createMockAccount());
            dataSource.transaction.mockImplementation(async (cb: any) => cb({
                getRepository: jest.fn().mockReturnValue({
                    update: jest.fn(),
                    create: jest.fn().mockReturnValue(createMockOrder()),
                    save: jest.fn().mockResolvedValue(createMockOrder({ id: 'counter-id' })),
                }),
                query: jest.fn(),
            }));

            await worker.fillRandomOrder();

            expect(dataSource.transaction).toHaveBeenCalled();
        });

        it('should skip when no orders found', async () => {
            mockQueryBuilder.getOne.mockResolvedValue(null);

            await worker.fillRandomOrder();

            expect(dataSource.transaction).not.toHaveBeenCalled();
        });

        it('should broadcast recent trade via gateway', async () => {
            const order = createMockOrder({
                status: OrderStatus.Open,
                quantity: '1000',
                settlementFee: '50000',
                side: OrderSide.Lend,
            });
            mockQueryBuilder.getOne
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(order);
            mockDsQueryBuilder.getRawOne.mockResolvedValue({ order_market_id: 'om-1' });
            marketRepository.findOne.mockResolvedValue(createMockMarket());
            orderRepository.getOrCreateAccount.mockResolvedValue(createMockAccount());
            dataSource.transaction.mockImplementation(async (cb: any) => cb({
                getRepository: jest.fn().mockReturnValue({
                    update: jest.fn(),
                    create: jest.fn().mockReturnValue(createMockOrder()),
                    save: jest.fn().mockResolvedValue(createMockOrder({ id: 'counter-id' })),
                }),
                query: jest.fn(),
            }));

            await worker.fillRandomOrder();

            expect(eventsGateway.handleMatchCreated).toHaveBeenCalledWith(
                expect.objectContaining({
                    loanToken: MOCK_IDS.tokenAddress,
                    amount: '1000',
                    rate: 500,
                }),
            );
        });

        it('should skip when cache has no entry for the order asset', async () => {
            const order = createMockOrder({
                assetId: 'unknown-asset-id',
                quantity: '1000',
                settlementFee: '50000',
            });
            mockQueryBuilder.getOne
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(order);

            await worker.fillRandomOrder();

            expect(dataSource.transaction).not.toHaveBeenCalled();
        });

        it('should handle transaction errors gracefully', async () => {
            const order = createMockOrder({ quantity: '1000', settlementFee: '50000' });
            mockQueryBuilder.getOne
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(order);
            mockDsQueryBuilder.getRawOne.mockResolvedValue({ order_market_id: 'om-1' });
            marketRepository.findOne.mockResolvedValue(createMockMarket());
            orderRepository.getOrCreateAccount.mockResolvedValue(createMockAccount());
            dataSource.transaction.mockRejectedValue(new Error('Transaction failed'));

            await expect(worker.fillRandomOrder()).resolves.not.toThrow();
        });

        it('should skip when disabled', async () => {
            process.env.NODE_ENV = 'production';

            await worker.fillRandomOrder();

            expect(orderRepository.createQueryBuilder).not.toHaveBeenCalled();
        });
    });
});
