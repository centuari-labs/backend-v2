import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { OrdersService } from '../../orders/orders.service';
import { Order } from '../../orders/entities/order.entity';
import { Account } from '../../orders/entities/account.entity';
import { Token } from '../../tokens/entities/token.entity';
import { OrderRepository } from '../../orders/repositories/order.repository';
import { PriceService } from '../../price/price.service';
import { TokensService } from '../../tokens/tokens.service';
import { NatsService } from '../../core/nats/nats.service';
import { OrderSide, OrderType, OrderStatus } from '../../orders/constants/order.constants';
import { CreateLendLimitOrderDto } from '../../orders/dto/create-lend-limit-order.dto';
import { CreateLendMarketOrderDto } from '../../orders/dto/create-lend-market-order.dto';
import { CreateBorrowLimitOrderDto } from '../../orders/dto/create-borrow-limit-order.dto';
import { CreateBorrowMarketOrderDto } from '../../orders/dto/create-borrow-market-order.dto';

describe('OrdersService', () => {
    let service: OrdersService;
    let orderRepository: jest.Mocked<OrderRepository>;
    let accountRepository: jest.Mocked<Repository<Account>>;
    let tokenRepository: jest.Mocked<Repository<Token>>;
    let tokensService: jest.Mocked<TokensService>;
    let natsService: jest.Mocked<NatsService>;

    const mockWalletAddress = '0xLender1234567890abcdef1234567890abcdef12';
    const mockPrivyUserId = 'did:privy:mock-user-id';
    const mockTokenAddress = '0xToken1234567890abcdef1234567890abcdef12';
    const mockAccountId = 'uuid-account-001';
    const mockAssetId = 'uuid-asset-001';

    const createMockOrder = (overrides: Partial<Order> = {}): Order => ({
        id: 'uuid-order-001',
        accountId: mockAccountId,
        assetId: mockAssetId,
        quantity: '1000',
        filledQuantity: '0',
        settlementFee: '0',
        filledSettlementFee: null,
        side: OrderSide.Lend,
        type: OrderType.Limit,
        status: OrderStatus.Open,
        rate: 500,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    });

    beforeEach(async () => {
        const mockOrderRepository = {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            getOpenOrders: jest.fn(),
        };

        const mockAccountRepository = {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
        };

        const mockTokenRepository = {
            findOne: jest.fn(),
        };

        const mockTokensService = {
            validateToken: jest.fn(),
        };

        const mockNatsService = {
            publish: jest.fn(),
        };

        const mockPriceService = {
            getPrice: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OrdersService,
                {
                    provide: getRepositoryToken(Order),
                    useValue: mockOrderRepository,
                },
                {
                    provide: getRepositoryToken(Account),
                    useValue: mockAccountRepository,
                },
                {
                    provide: getRepositoryToken(Token),
                    useValue: mockTokenRepository,
                },
                {
                    provide: PriceService,
                    useValue: mockPriceService,
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
        accountRepository = module.get(getRepositoryToken(Account));
        tokenRepository = module.get(getRepositoryToken(Token));
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
            accountRepository.findOne.mockResolvedValue({ id: mockAccountId } as Account);
            tokenRepository.findOne.mockResolvedValue({ id: mockAssetId } as Token);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createLendLimitOrder(lendLimitDto, mockWalletAddress, mockPrivyUserId);

            expect(result.side).toBe(OrderSide.Lend);
            expect(result.type).toBe(OrderType.Limit);
            expect(result.rate).toBe(500);
            expect(tokensService.validateToken).toHaveBeenCalledWith(mockTokenAddress);
        });

        it('should set filledQuantity to 0 on creation', async () => {
            const expectedOrder = createMockOrder({
                quantity: '1000',
                filledQuantity: '0',
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            accountRepository.findOne.mockResolvedValue({ id: mockAccountId } as Account);
            tokenRepository.findOne.mockResolvedValue({ id: mockAssetId } as Token);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createLendLimitOrder(lendLimitDto, mockWalletAddress, mockPrivyUserId);

            expect(result.filledQuantity).toBe('0');
        });

        it('should set initial status to Open', async () => {
            const expectedOrder = createMockOrder({ status: OrderStatus.Open });

            tokensService.validateToken.mockResolvedValue({} as any);
            accountRepository.findOne.mockResolvedValue({ id: mockAccountId } as Account);
            tokenRepository.findOne.mockResolvedValue({ id: mockAssetId } as Token);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createLendLimitOrder(lendLimitDto, mockWalletAddress, mockPrivyUserId);

            expect(result.status).toBe(OrderStatus.Open);
        });

        it('should publish order to NATS', async () => {
            const expectedOrder = createMockOrder();

            tokensService.validateToken.mockResolvedValue({} as any);
            accountRepository.findOne.mockResolvedValue({ id: mockAccountId } as Account);
            tokenRepository.findOne.mockResolvedValue({ id: mockAssetId } as Token);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            natsService.publish.mockResolvedValue(undefined);

            await service.createLendLimitOrder(lendLimitDto, mockWalletAddress, mockPrivyUserId);

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
                service.createLendLimitOrder(lendLimitDto, mockWalletAddress, mockPrivyUserId),
            ).rejects.toThrow(BadRequestException);
        });

        it('should create new account if wallet not found', async () => {
            const expectedOrder = createMockOrder();
            tokensService.validateToken.mockResolvedValue({} as any);
            accountRepository.findOne.mockResolvedValue(null);
            accountRepository.create.mockReturnValue({ id: 'new-account-id' } as Account);
            accountRepository.save.mockResolvedValue({ id: 'new-account-id' } as Account);
            tokenRepository.findOne.mockResolvedValue({ id: mockAssetId } as Token);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            natsService.publish.mockResolvedValue(undefined);

            await service.createLendLimitOrder(lendLimitDto, mockWalletAddress, mockPrivyUserId);

            expect(accountRepository.create).toHaveBeenCalledWith({
                userWallet: mockWalletAddress,
                privyUserId: mockPrivyUserId,
            });
            expect(accountRepository.save).toHaveBeenCalled();
        });

        it('should throw NotFoundException if asset not found', async () => {
            tokensService.validateToken.mockResolvedValue({} as any);
            accountRepository.findOne.mockResolvedValue({ id: mockAccountId } as Account);
            tokenRepository.findOne.mockResolvedValue(null);

            await expect(
                service.createLendLimitOrder(lendLimitDto, mockWalletAddress, mockPrivyUserId),
            ).rejects.toThrow(NotFoundException);
        });
    });

    describe('createLendMarketOrder', () => {
        const lendMarketDto: CreateLendMarketOrderDto = {
            loanToken: mockTokenAddress,
            amount: '1000',
            maturities: [1704067200],
        };

        it('should create a lend market order with 0 rate', async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Market,
                rate: 0,
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            accountRepository.findOne.mockResolvedValue({ id: mockAccountId } as Account);
            tokenRepository.findOne.mockResolvedValue({ id: mockAssetId } as Token);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createLendMarketOrder(lendMarketDto, mockWalletAddress, mockPrivyUserId);

            expect(result.side).toBe(OrderSide.Lend);
            expect(result.type).toBe(OrderType.Market);
            expect(result.rate).toBe(0);
        });

        it('should publish to lend market NATS subject', async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Lend,
                type: OrderType.Market,
                rate: 0,
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            accountRepository.findOne.mockResolvedValue({ id: mockAccountId } as Account);
            tokenRepository.findOne.mockResolvedValue({ id: mockAssetId } as Token);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            natsService.publish.mockResolvedValue(undefined);

            await service.createLendMarketOrder(lendMarketDto, mockWalletAddress, mockPrivyUserId);

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
                quantity: '5000',
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            accountRepository.findOne.mockResolvedValue({ id: mockAccountId } as Account);
            tokenRepository.findOne.mockResolvedValue({ id: mockAssetId } as Token);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createBorrowLimitOrder(borrowLimitDto, mockWalletAddress, mockPrivyUserId);

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
            accountRepository.findOne.mockResolvedValue({ id: mockAccountId } as Account);
            tokenRepository.findOne.mockResolvedValue({ id: mockAssetId } as Token);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            natsService.publish.mockResolvedValue(undefined);

            await service.createBorrowLimitOrder(borrowLimitDto, mockWalletAddress, mockPrivyUserId);

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

        it('should create a borrow market order with 0 rate', async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Market,
                rate: 0,
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            accountRepository.findOne.mockResolvedValue({ id: mockAccountId } as Account);
            tokenRepository.findOne.mockResolvedValue({ id: mockAssetId } as Token);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.createBorrowMarketOrder(borrowMarketDto, mockWalletAddress, mockPrivyUserId);

            expect(result.side).toBe(OrderSide.Borrow);
            expect(result.type).toBe(OrderType.Market);
            expect(result.rate).toBe(0);
        });

        it('should publish to borrow market NATS subject', async () => {
            const expectedOrder = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Market,
                rate: 0,
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            accountRepository.findOne.mockResolvedValue({ id: mockAccountId } as Account);
            tokenRepository.findOne.mockResolvedValue({ id: mockAssetId } as Token);
            orderRepository.create.mockReturnValue(expectedOrder);
            orderRepository.save.mockResolvedValue(expectedOrder);
            natsService.publish.mockResolvedValue(undefined);

            await service.createBorrowMarketOrder(borrowMarketDto, mockWalletAddress, mockPrivyUserId);

            expect(natsService.publish).toHaveBeenCalledWith(
                'orders.borrow.market',
                expect.anything(),
            );
        });
    });

    describe('cancelOrder', () => {
        it('should cancel an open order successfully', async () => {
            const openOrder = createMockOrder({
                id: 'uuid-cancel-001',
                status: OrderStatus.Open,
            });

            const cancelledOrder = {
                ...openOrder,
                status: OrderStatus.Cancelled,
            };

            orderRepository.getOpenOrders.mockResolvedValue([openOrder]);
            accountRepository.findOne.mockResolvedValue({ id: mockAccountId } as Account);
            orderRepository.save.mockResolvedValue(cancelledOrder);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.cancelOrder('uuid-cancel-001', mockWalletAddress);

            expect(result.status).toBe(OrderStatus.Cancelled);
        });

        it('should cancel a partial order successfully', async () => {
            const partialOrder = createMockOrder({
                id: 'uuid-cancel-002',
                status: OrderStatus.PartiallyFilled,
                quantity: '1000',
                filledQuantity: '500',
            });

            const cancelledOrder = {
                ...partialOrder,
                status: OrderStatus.Cancelled,
            };

            orderRepository.getOpenOrders.mockResolvedValue([partialOrder]);
            accountRepository.findOne.mockResolvedValue({ id: mockAccountId } as Account);
            orderRepository.save.mockResolvedValue(cancelledOrder);
            natsService.publish.mockResolvedValue(undefined);

            const result = await service.cancelOrder('uuid-cancel-002', mockWalletAddress);

            expect(result.status).toBe(OrderStatus.Cancelled);
        });

        it('should throw NotFoundException for non-existent order', async () => {
            orderRepository.getOpenOrders.mockResolvedValue([]);

            await expect(
                service.cancelOrder('non-existent-uuid', mockWalletAddress),
            ).rejects.toThrow(NotFoundException);
        });

        it('should throw ForbiddenException when cancelling order owned by another wallet', async () => {
            const otherWalletOrder = createMockOrder({
                id: 'uuid-cancel-003',
                accountId: 'other-account-uuid',
                status: OrderStatus.Open,
            });

            orderRepository.getOpenOrders.mockResolvedValue([otherWalletOrder]);
            accountRepository.findOne.mockResolvedValue({ id: mockAccountId } as Account);

            await expect(
                service.cancelOrder('uuid-cancel-003', mockWalletAddress),
            ).rejects.toThrow(ForbiddenException);
        });

        it('should throw BadRequestException when cancelling a filled order', async () => {
            const filledOrder = createMockOrder({
                id: 'uuid-cancel-004',
                status: OrderStatus.Filled,
            });

            orderRepository.getOpenOrders.mockResolvedValue([filledOrder]);
            accountRepository.findOne.mockResolvedValue({ id: mockAccountId } as Account);

            await expect(
                service.cancelOrder('uuid-cancel-004', mockWalletAddress),
            ).rejects.toThrow(BadRequestException);
        });

        it('should throw BadRequestException when cancelling an already cancelled order', async () => {
            const cancelledOrder = createMockOrder({
                id: 'uuid-cancel-005',
                status: OrderStatus.Cancelled,
            });

            orderRepository.getOpenOrders.mockResolvedValue([cancelledOrder]);
            accountRepository.findOne.mockResolvedValue({ id: mockAccountId } as Account);

            await expect(
                service.cancelOrder('uuid-cancel-005', mockWalletAddress),
            ).rejects.toThrow(BadRequestException);
        });

        it('should publish cancel event to NATS', async () => {
            const openOrder = createMockOrder({
                id: 'uuid-cancel-007',
                status: OrderStatus.Open,
            });

            orderRepository.getOpenOrders.mockResolvedValue([openOrder]);
            accountRepository.findOne.mockResolvedValue({ id: mockAccountId } as Account);
            orderRepository.save.mockResolvedValue({
                ...openOrder,
                status: OrderStatus.Cancelled,
            });
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
});
