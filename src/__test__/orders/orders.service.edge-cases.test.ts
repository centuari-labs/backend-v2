import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { NatsService } from "../../core/nats/nats.service";
import {
    OrderSide,
    OrderStatus,
    OrderType,
} from "../../orders/constants/order.constants";
import { Account } from "../../orders/entities/account.entity";
import { Order } from "../../orders/entities/order.entity";
import { OrdersService } from "../../orders/orders.service";
import { Token } from "../../tokens/entities/token.entity";
import { TokensService } from "../../tokens/tokens.service";
import {
    createMockOrder,
    mockAccountId,
    mockAssetId,
    mockPrivyUserId,
    mockTokenAddress,
    mockWalletAddress,
} from "../helpers/mock-factories";

describe("OrdersService - Edge Cases", () => {
    let service: OrdersService;
    let orderRepository: jest.Mocked<Repository<Order>>;
    let accountRepository: jest.Mocked<Repository<Account>>;
    let tokenRepository: jest.Mocked<Repository<Token>>;
    let tokensService: jest.Mocked<TokensService>;
    let natsService: jest.Mocked<NatsService>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OrdersService,
                {
                    provide: getRepositoryToken(Order),
                    useValue: {
                        create: jest.fn(),
                        save: jest.fn(),
                        findOne: jest.fn(),
                    },
                },
                {
                    provide: getRepositoryToken(Account),
                    useValue: {
                        findOne: jest.fn(),
                        create: jest.fn(),
                        save: jest.fn(),
                    },
                },
                {
                    provide: getRepositoryToken(Token),
                    useValue: { findOne: jest.fn() },
                },
                {
                    provide: TokensService,
                    useValue: { validateToken: jest.fn() },
                },
                {
                    provide: NatsService,
                    useValue: { publish: jest.fn() },
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

    describe("NATS publish failure resilience", () => {
        it("should not throw when NATS publish fails on order creation", async () => {
            const dto = {
                loanToken: mockTokenAddress,
                amount: "1000",
                maturities: [1],
                rate: 500,
            };
            const order = createMockOrder();

            tokensService.validateToken.mockResolvedValue({} as any);
            accountRepository.findOne.mockResolvedValue({
                id: mockAccountId,
            } as Account);
            tokenRepository.findOne.mockResolvedValue({
                id: mockAssetId,
            } as Token);
            orderRepository.create.mockReturnValue(order);
            orderRepository.save.mockResolvedValue(order);
            natsService.publish.mockRejectedValue(
                new Error("NATS connection timeout"),
            );

            // Should NOT throw - NATS failures are caught silently
            const result = await service.createLendLimitOrder(
                dto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(result).toEqual(order);
        });

        it("should not throw when NATS publish fails on market order creation", async () => {
            const dto = {
                loanToken: mockTokenAddress,
                amount: "500",
                maturities: [1],
            };
            const order = createMockOrder({ type: OrderType.Market, rate: 0 });

            tokensService.validateToken.mockResolvedValue({} as any);
            accountRepository.findOne.mockResolvedValue({
                id: mockAccountId,
            } as Account);
            tokenRepository.findOne.mockResolvedValue({
                id: mockAssetId,
            } as Token);
            orderRepository.create.mockReturnValue(order);
            orderRepository.save.mockResolvedValue(order);
            natsService.publish.mockRejectedValue(new Error("NATS down"));

            const result = await service.createLendMarketOrder(
                dto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(result).toEqual(order);
        });

        it("should not throw when NATS cancel publish fails", async () => {
            const order = createMockOrder({ status: OrderStatus.Open });
            const cancelledOrder = { ...order, status: OrderStatus.Cancelled };

            orderRepository.findOne.mockResolvedValue(order);
            accountRepository.findOne.mockResolvedValue({
                id: mockAccountId,
            } as Account);
            orderRepository.save.mockResolvedValue(cancelledOrder);
            natsService.publish.mockRejectedValue(
                new Error("NATS publish failed"),
            );

            const result = await service.cancelOrder(
                order.id,
                mockWalletAddress,
            );

            expect(result.status).toBe(OrderStatus.Cancelled);
        });
    });

    describe("cancelOrder - account not found", () => {
        it("should throw ForbiddenException when account not found for wallet", async () => {
            const order = createMockOrder({ status: OrderStatus.Open });

            orderRepository.findOne.mockResolvedValue(order);
            accountRepository.findOne.mockResolvedValue(null);

            await expect(
                service.cancelOrder(order.id, "unknown-wallet"),
            ).rejects.toThrow(ForbiddenException);
        });

        it("should throw with correct message when account not found", async () => {
            const order = createMockOrder({ status: OrderStatus.Open });

            orderRepository.findOne.mockResolvedValue(order);
            accountRepository.findOne.mockResolvedValue(null);

            await expect(
                service.cancelOrder(order.id, "unknown-wallet"),
            ).rejects.toThrow("Account not found for this wallet");
        });
    });

    describe("getAssetId - NotFoundException", () => {
        it("should throw NotFoundException with token address in message", async () => {
            const dto = {
                loanToken: "0xMissing",
                amount: "100",
                maturities: [1],
                rate: 100,
            };

            tokensService.validateToken.mockResolvedValue({} as any);
            accountRepository.findOne.mockResolvedValue({
                id: mockAccountId,
            } as Account);
            tokenRepository.findOne.mockResolvedValue(null);

            await expect(
                service.createLendLimitOrder(
                    dto,
                    mockWalletAddress,
                    mockPrivyUserId,
                ),
            ).rejects.toThrow("Asset for token 0xMissing not found");
        });
    });

    describe("getOrCreateAccount - existing account", () => {
        it("should use existing account without creating new one", async () => {
            const dto = {
                loanToken: mockTokenAddress,
                amount: "100",
                maturities: [1],
                rate: 100,
            };
            const order = createMockOrder();

            tokensService.validateToken.mockResolvedValue({} as any);
            accountRepository.findOne.mockResolvedValue({
                id: mockAccountId,
            } as Account);
            tokenRepository.findOne.mockResolvedValue({
                id: mockAssetId,
            } as Token);
            orderRepository.create.mockReturnValue(order);
            orderRepository.save.mockResolvedValue(order);
            natsService.publish.mockResolvedValue(undefined);

            await service.createLendLimitOrder(
                dto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(accountRepository.create).not.toHaveBeenCalled();
            expect(accountRepository.save).not.toHaveBeenCalled();
        });
    });

    describe("order repository save failure", () => {
        it("should propagate repository save errors", async () => {
            const dto = {
                loanToken: mockTokenAddress,
                amount: "100",
                maturities: [1],
                rate: 100,
            };

            tokensService.validateToken.mockResolvedValue({} as any);
            accountRepository.findOne.mockResolvedValue({
                id: mockAccountId,
            } as Account);
            tokenRepository.findOne.mockResolvedValue({
                id: mockAssetId,
            } as Token);
            orderRepository.create.mockReturnValue(createMockOrder());
            orderRepository.save.mockRejectedValue(
                new Error("DB constraint violation"),
            );

            await expect(
                service.createLendLimitOrder(
                    dto,
                    mockWalletAddress,
                    mockPrivyUserId,
                ),
            ).rejects.toThrow("DB constraint violation");
        });
    });

    describe("borrow order NATS publish failure resilience", () => {
        it("should not throw when NATS publish fails on borrow limit order", async () => {
            const dto = {
                loanToken: mockTokenAddress,
                amount: "1000",
                maturities: [1],
                rate: 500,
            };
            const order = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Limit,
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            accountRepository.findOne.mockResolvedValue({
                id: mockAccountId,
            } as Account);
            tokenRepository.findOne.mockResolvedValue({
                id: mockAssetId,
            } as Token);
            orderRepository.create.mockReturnValue(order);
            orderRepository.save.mockResolvedValue(order);
            natsService.publish.mockRejectedValue(new Error("NATS error"));

            const result = await service.createBorrowLimitOrder(
                dto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(result).toEqual(order);
        });

        it("should not throw when NATS publish fails on borrow market order", async () => {
            const dto = {
                loanToken: mockTokenAddress,
                amount: "500",
                maturities: [1],
            };
            const order = createMockOrder({
                side: OrderSide.Borrow,
                type: OrderType.Market,
                rate: 0,
            });

            tokensService.validateToken.mockResolvedValue({} as any);
            accountRepository.findOne.mockResolvedValue({
                id: mockAccountId,
            } as Account);
            tokenRepository.findOne.mockResolvedValue({
                id: mockAssetId,
            } as Token);
            orderRepository.create.mockReturnValue(order);
            orderRepository.save.mockResolvedValue(order);
            natsService.publish.mockRejectedValue(new Error("NATS error"));

            const result = await service.createBorrowMarketOrder(
                dto,
                mockWalletAddress,
                mockPrivyUserId,
            );

            expect(result).toEqual(order);
        });
    });
});
