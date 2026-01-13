import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { OrdersService } from '../../orders/orders.service';
import { Order } from '../../orders/entities/order.entity';
import { OrderHistory } from '../../orders/entities/order-history.entity';
import { TokensService } from '../../tokens/tokens.service';
import { NatsService } from '../../core/nats/nats.service';
import { OrderSide, OrderType, OrderStatus } from '../../orders/constants/order.constants';
import { CreateLendLimitOrderDto } from '../../orders/dto/create-lend-limit-order.dto';
import { CreateLendMarketOrderDto } from '../../orders/dto/create-lend-market-order.dto';
import { CreateBorrowLimitOrderDto } from '../../orders/dto/create-borrow-limit-order.dto';
import { CreateBorrowMarketOrderDto } from '../../orders/dto/create-borrow-market-order.dto';

describe('OrdersService', () => {
    let service: OrdersService;
    let orderRepository: jest.Mocked<Repository<Order>>;
    let orderHistoryRepository: jest.Mocked<Repository<OrderHistory>>;
    let tokensService: jest.Mocked<TokensService>;
    let natsService: jest.Mocked<NatsService>;

    const mockWalletAddress = '0xLender1234567890abcdef1234567890abcdef12';
    const mockTokenAddress = '0xToken1234567890abcdef1234567890abcdef12';

    const createMockOrder = (overrides: Partial<Order> = {}): Order => ({
        orderId: 'uuid-order-001',
        walletAddress: mockWalletAddress,
        loanToken: mockTokenAddress,
        maturities: [1704067200],
        originalAmount: '1000',
        remainingAmount: '1000',
        settlementFeeAmount: '0',
        side: OrderSide.Lend,
        type: OrderType.Limit,
        status: OrderStatus.Open,
        rate: 500,
        timestamp: Date.now(),
        transactionHash: null,
        blockNumber: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        filledAt: null,
        cancelledAt: null,
        ...overrides,
    });

    beforeEach(async () => {
        const mockOrderRepository = {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
        };

        const mockOrderHistoryRepository = {
            create: jest.fn(),
            save: jest.fn(),
        };

        const mockTokensService = {
            validateToken: jest.fn(),
        };

        const mockNatsService = {
            publish: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OrdersService,
                {
                    provide: getRepositoryToken(Order),
                    useValue: mockOrderRepository,
                },
                {
                    provide: getRepositoryToken(OrderHistory),
                    useValue: mockOrderHistoryRepository,
                },
                {
                    provide: TokensService,
                    useValue: mockTokensService,
                },
                {
                    provide: NatsService,
                    useValue: mockNatsService,
                },
            ],
        }).compile();

        service = module.get<OrdersService>(OrdersService);
        orderRepository = module.get(getRepositoryToken(Order));
        orderHistoryRepository = module.get(getRepositoryToken(OrderHistory));
        tokensService = module.get(TokensService);
        natsService = module.get(NatsService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('createLendLimitOrder', () => {
        const lendLimitDto: CreateLendLimitOrderDto = {
            loanToken: mockTokenAddress,
            amount: '1000',
            maturities: [1704067200],
            rate: 500,
        };

        it('should create a lend limit order with correct fields', async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Limit,
                rate: 500,
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            orderHistoryRepository.create.mockReturnValue({} as any);
            orderHistoryRepository.save.mockResolvedValue({} as any);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createLendLimitOrder(lendLimitDto, mockWalletAddress);

            expect(result.side).toBe(OrderSide.Lend);
            expect(result.type).toBe(OrderType.Limit);
            expect(result.rate).toBe(500);
            expect(tokensService.validateToken).toHaveBeenCalledWith(mockTokenAddress);
        });

        it('should set remainingAmount equal to originalAmount on creation', async () => {
            const expectedOrder = createMockOrder({
                originalAmount: '1000',
                remainingAmount: '1000',
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            orderHistoryRepository.create.mockReturnValue({} as any);
            orderHistoryRepository.save.mockResolvedValue({} as any);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createLendLimitOrder(lendLimitDto, mockWalletAddress);

            expect(result.remainingAmount).toBe(result.originalAmount);
        });

        it('should set initial status to Open', async () => {
            const expectedOrder = createMockOrder({ status: OrderStatus.Open });

            tokensService.validateToken.mockResolvedValue({} as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            orderHistoryRepository.create.mockReturnValue({} as any);
            orderHistoryRepository.save.mockResolvedValue({} as any);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createLendLimitOrder(lendLimitDto, mockWalletAddress);

            expect(result.status).toBe(OrderStatus.Open);
        });

        it('should create order history entry on creation', async () => {
            const expectedOrder = createMockOrder();

            tokensService.validateToken.mockResolvedValue({} as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            orderHistoryRepository.create.mockReturnValue({} as any);
            orderHistoryRepository.save.mockResolvedValue({} as any);
            natsService.publish.mockResolvedValue(undefined);

            await service.createLendLimitOrder(lendLimitDto, mockWalletAddress);

            expect(orderHistoryRepository.create).toHaveBeenCalled();
            expect(orderHistoryRepository.save).toHaveBeenCalled();
        });

        it('should publish order to NATS', async () => {
            const expectedOrder = createMockOrder();

            tokensService.validateToken.mockResolvedValue({} as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            orderHistoryRepository.create.mockReturnValue({} as any);
            orderHistoryRepository.save.mockResolvedValue({} as any);
            natsService.publish.mockResolvedValue(undefined);

            await service.createLendLimitOrder(lendLimitDto, mockWalletAddress);

            expect(natsService.publish).toHaveBeenCalledWith(
                'orders.lend.limit',
                expect.objectContaining({
                    event: 'orders.lend.limit',
                    data: expectedOrder,
                }),
            );
        });

        it('should throw BadRequestException for unsupported token', async () => {
            tokensService.validateToken.mockRejectedValue(
                new BadRequestException('Token not supported'),
            );

            await expect(
                service.createLendLimitOrder(lendLimitDto, mockWalletAddress),
            ).rejects.toThrow(BadRequestException);
        });
    });

    describe('createLendMarketOrder', () => {
        const lendMarketDto: CreateLendMarketOrderDto = {
            loanToken: mockTokenAddress,
            amount: '1000',
            maturities: [1704067200],
        };

        it('should create a lend market order with null rate', async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Market,
                rate: null,
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            orderHistoryRepository.create.mockReturnValue({} as any);
            orderHistoryRepository.save.mockResolvedValue({} as any);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createLendMarketOrder(lendMarketDto, mockWalletAddress);

            expect(result.side).toBe(OrderSide.Lend);
            expect(result.type).toBe(OrderType.Market);
            expect(result.rate).toBeNull();
        });

        it('should publish to lend market NATS subject', async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Market,
                rate: null,
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            orderHistoryRepository.create.mockReturnValue({} as any);
            orderHistoryRepository.save.mockResolvedValue({} as any);
            natsService.publish.mockResolvedValue(undefined);

            await service.createLendMarketOrder(lendMarketDto, mockWalletAddress);

            expect(natsService.publish).toHaveBeenCalledWith(
                'orders.lend.market',
                expect.anything(),
            );
        });
    });

    describe('createBorrowLimitOrder', () => {
        const borrowLimitDto: CreateBorrowLimitOrderDto = {
            loanToken: mockTokenAddress,
            amount: '5000',
            maturities: [1704067200],
            rate: 750,
        };

        it('should create a borrow limit order with correct fields', async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Limit,
                rate: 750,
                originalAmount: '5000',
                remainingAmount: '5000',
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            orderHistoryRepository.create.mockReturnValue({} as any);
            orderHistoryRepository.save.mockResolvedValue({} as any);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createBorrowLimitOrder(borrowLimitDto, mockWalletAddress);

            expect(result.side).toBe(OrderSide.Borrow);
            expect(result.type).toBe(OrderType.Limit);
            expect(result.rate).toBe(750);
        });

        it('should publish to borrow limit NATS subject', async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Limit,
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            orderHistoryRepository.create.mockReturnValue({} as any);
            orderHistoryRepository.save.mockResolvedValue({} as any);
            natsService.publish.mockResolvedValue(undefined);

            await service.createBorrowLimitOrder(borrowLimitDto, mockWalletAddress);

            expect(natsService.publish).toHaveBeenCalledWith(
                'orders.borrow.limit',
                expect.anything(),
            );
        });
    });

    describe('createBorrowMarketOrder', () => {
        const borrowMarketDto: CreateBorrowMarketOrderDto = {
            loanToken: mockTokenAddress,
            amount: '5000',
            maturities: [1704067200],
        };

        it('should create a borrow market order with null rate', async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Market,
                rate: null,
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            orderHistoryRepository.create.mockReturnValue({} as any);
            orderHistoryRepository.save.mockResolvedValue({} as any);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createBorrowMarketOrder(borrowMarketDto, mockWalletAddress);

            expect(result.side).toBe(OrderSide.Borrow);
            expect(result.type).toBe(OrderType.Market);
            expect(result.rate).toBeNull();
        });

        it('should publish to borrow market NATS subject', async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Market,
                rate: null,
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            orderHistoryRepository.create.mockReturnValue({} as any);
            orderHistoryRepository.save.mockResolvedValue({} as any);
            natsService.publish.mockResolvedValue(undefined);

            await service.createBorrowMarketOrder(borrowMarketDto, mockWalletAddress);

            expect(natsService.publish).toHaveBeenCalledWith(
                'orders.borrow.market',
                expect.anything(),
            );
        });
    });

    describe('cancelOrder', () => {
        it('should cancel an open order successfully', async () => {
            const openOrder = createMockOrder({
                orderId: 'uuid-cancel-001',
                status: OrderStatus.Open,
            });

            const cancelledOrder = {
                ...openOrder,
                status: OrderStatus.Cancelled,
                cancelledAt: new Date(),
            };

            orderRepository.findOne.mockResolvedValue(openOrder);
            orderRepository.save.mockResolvedValue(cancelledOrder);
            orderHistoryRepository.create.mockReturnValue({} as any);
            orderHistoryRepository.save.mockResolvedValue({} as any);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.cancelOrder('uuid-cancel-001', mockWalletAddress);

            expect(result.status).toBe(OrderStatus.Cancelled);
            expect(result.cancelledAt).toBeDefined();
        });

        it('should cancel a partial order successfully', async () => {
            const partialOrder = createMockOrder({
                orderId: 'uuid-cancel-002',
                status: OrderStatus.Partial,
                originalAmount: '1000',
                remainingAmount: '500',
            });

            const cancelledOrder = {
                ...partialOrder,
                status: OrderStatus.Cancelled,
                cancelledAt: new Date(),
            };

            orderRepository.findOne.mockResolvedValue(partialOrder);
            orderRepository.save.mockResolvedValue(cancelledOrder);
            orderHistoryRepository.create.mockReturnValue({} as any);
            orderHistoryRepository.save.mockResolvedValue({} as any);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.cancelOrder('uuid-cancel-002', mockWalletAddress);

            expect(result.status).toBe(OrderStatus.Cancelled);
        });

        it('should throw NotFoundException for non-existent order', async () => {
            orderRepository.findOne.mockResolvedValue(null);

            await expect(
                service.cancelOrder('non-existent-uuid', mockWalletAddress),
            ).rejects.toThrow(NotFoundException);
        });

        it('should throw ForbiddenException when cancelling order owned by another wallet', async () => {
            const otherWalletOrder = createMockOrder({
                orderId: 'uuid-cancel-003',
                walletAddress: '0xOtherWallet1234567890abcdef1234567890ab',
                status: OrderStatus.Open,
            });

            orderRepository.findOne.mockResolvedValue(otherWalletOrder);

            await expect(
                service.cancelOrder('uuid-cancel-003', mockWalletAddress),
            ).rejects.toThrow(ForbiddenException);
        });

        it('should throw BadRequestException when cancelling a filled order', async () => {
            const filledOrder = createMockOrder({
                orderId: 'uuid-cancel-004',
                status: OrderStatus.Filled,
            });

            orderRepository.findOne.mockResolvedValue(filledOrder);

            await expect(
                service.cancelOrder('uuid-cancel-004', mockWalletAddress),
            ).rejects.toThrow(BadRequestException);
        });

        it('should throw BadRequestException when cancelling an already cancelled order', async () => {
            const cancelledOrder = createMockOrder({
                orderId: 'uuid-cancel-005',
                status: OrderStatus.Cancelled,
            });

            orderRepository.findOne.mockResolvedValue(cancelledOrder);

            await expect(
                service.cancelOrder('uuid-cancel-005', mockWalletAddress),
            ).rejects.toThrow(BadRequestException);
        });

        it('should create order history entry on cancellation', async () => {
            const openOrder = createMockOrder({
                orderId: 'uuid-cancel-006',
                status: OrderStatus.Open,
            });

            orderRepository.findOne.mockResolvedValue(openOrder);
            orderRepository.save.mockResolvedValue({
                ...openOrder,
                status: OrderStatus.Cancelled,
            });
            orderHistoryRepository.create.mockReturnValue({} as any);
            orderHistoryRepository.save.mockResolvedValue({} as any);
            natsService.publish.mockResolvedValue(undefined);

            await service.cancelOrder('uuid-cancel-006', mockWalletAddress);

            expect(orderHistoryRepository.create).toHaveBeenCalled();
            expect(orderHistoryRepository.save).toHaveBeenCalled();
        });

        it('should publish cancel event to NATS', async () => {
            const openOrder = createMockOrder({
                orderId: 'uuid-cancel-007',
                status: OrderStatus.Open,
            });

            orderRepository.findOne.mockResolvedValue(openOrder);
            orderRepository.save.mockResolvedValue({
                ...openOrder,
                status: OrderStatus.Cancelled,
            });
            orderHistoryRepository.create.mockReturnValue({} as any);
            orderHistoryRepository.save.mockResolvedValue({} as any);
            natsService.publish.mockResolvedValue(undefined);

            await service.cancelOrder('uuid-cancel-007', mockWalletAddress);

            expect(natsService.publish).toHaveBeenCalledWith(
                'orders.cancel',
                expect.objectContaining({
                    event: 'orders.cancel',
                    data: expect.objectContaining({
                        orderId: 'uuid-cancel-007',
                        walletAddress: mockWalletAddress,
                    }),
                }),
            );
        });
    });

    describe('order lifecycle invariants', () => {
        it('should ensure remainingAmount never exceeds originalAmount on creation', async () => {
            const dto: CreateLendLimitOrderDto = {
                loanToken: mockTokenAddress,
                amount: '1000',
                maturities: [1704067200],
                rate: 500,
            };

            const expectedOrder = createMockOrder({
                originalAmount: '1000',
                remainingAmount: '1000',
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            orderRepository.create.mockImplementation((data) => ({
                ...expectedOrder,
                ...data,
            }) as Order);
            orderRepository.save.mockImplementation((order) => Promise.resolve(order as Order));
            orderHistoryRepository.create.mockReturnValue({} as any);
            orderHistoryRepository.save.mockResolvedValue({} as any);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createLendLimitOrder(dto, mockWalletAddress);

            expect(Number(result.remainingAmount)).toBeLessThanOrEqual(
                Number(result.originalAmount),
            );
        });

        it('should store timestamp on order creation', async () => {
            const beforeTimestamp = Date.now();

            const dto: CreateLendLimitOrderDto = {
                loanToken: mockTokenAddress,
                amount: '1000',
                maturities: [1704067200],
                rate: 500,
            };

            let capturedTimestamp: number = 0;

            orderRepository.create.mockImplementation((data: any): Order => {
                capturedTimestamp = data.timestamp;
                return createMockOrder(data);
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            orderRepository.save.mockImplementation((order): Promise<Order> => Promise.resolve(order as Order));
            orderHistoryRepository.create.mockReturnValue({} as any);
            orderHistoryRepository.save.mockResolvedValue({} as any);
            natsService.publish.mockResolvedValue(undefined);

            await service.createLendLimitOrder(dto, mockWalletAddress);

            const afterTimestamp = Date.now();

            expect(capturedTimestamp).toBeGreaterThanOrEqual(beforeTimestamp);
            expect(capturedTimestamp).toBeLessThanOrEqual(afterTimestamp);
        });
    });
});
