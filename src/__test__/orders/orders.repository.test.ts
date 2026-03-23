import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource, Repository, SelectQueryBuilder } from "typeorm";
import { OrderRepository } from "../../orders/repositories/order.repository";
import { Order } from "../../orders/entities/order.entity";
import { OrderMarket } from "../../orders/entities/order-market.entity";
import { Account } from "../../orders/entities/account.entity";
import {
    OrderSide,
    OrderStatus,
    OrderType,
} from "../../orders/constants/order.constants";
import {
    createMockOrder,
    createMockAccount,
    MOCK_IDS,
} from "../helpers/mock-factories";

describe("OrderRepository", () => {
    let repository: OrderRepository;
    let dataSource: jest.Mocked<DataSource>;
    let accountRepository: jest.Mocked<Repository<Account>>;

    beforeEach(async () => {
        const mockAccountRepo = {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            createQueryBuilder: jest.fn(),
        };

        const mockEntityManager = {
            getRepository: jest.fn(),
        };

        const mockDataSource = {
            transaction: jest.fn(),
            createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OrderRepository,
                { provide: DataSource, useValue: mockDataSource },
                {
                    provide: getRepositoryToken(Account),
                    useValue: mockAccountRepo,
                },
            ],
        }).compile();

        repository = module.get<OrderRepository>(OrderRepository);
        dataSource = module.get(DataSource) as jest.Mocked<DataSource>;
        accountRepository = module.get(
            getRepositoryToken(Account),
        ) as jest.Mocked<Repository<Account>>;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("saveOrderWithMarkets", () => {
        it("should save order and order_market rows in transaction", async () => {
            const order = createMockOrder();
            const marketIds = [MOCK_IDS.marketId];
            const savedOrder = { ...order, id: "saved-order-id" } as Order;

            const mockOrderRepo = {
                save: jest.fn().mockResolvedValue(savedOrder),
            };
            const mockOrderMarketRepo = {
                save: jest.fn().mockResolvedValue({}),
            };

            dataSource.transaction.mockImplementation(async (cb: any) => {
                const manager = {
                    getRepository: jest.fn((entity: any) => {
                        if (entity === Order) return mockOrderRepo;
                        if (entity === OrderMarket) return mockOrderMarketRepo;
                        return {};
                    }),
                };
                return cb(manager);
            });

            const result = await repository.saveOrderWithMarkets(
                order,
                marketIds,
            );

            expect(result).toEqual(savedOrder);
            expect(mockOrderRepo.save).toHaveBeenCalledWith(order);
            expect(mockOrderMarketRepo.save).toHaveBeenCalledWith({
                orderId: "saved-order-id",
                marketId: MOCK_IDS.marketId,
            });
        });

        it("should create multiple order_market rows for multiple marketIds", async () => {
            const order = createMockOrder();
            const marketIds = ["market-1", "market-2", "market-3"];
            const savedOrder = { ...order, id: "saved-order-id" } as Order;

            const mockOrderRepo = {
                save: jest.fn().mockResolvedValue(savedOrder),
            };
            const mockOrderMarketRepo = {
                save: jest.fn().mockResolvedValue({}),
            };

            dataSource.transaction.mockImplementation(async (cb: any) => {
                const manager = {
                    getRepository: jest.fn((entity: any) => {
                        if (entity === Order) return mockOrderRepo;
                        if (entity === OrderMarket) return mockOrderMarketRepo;
                        return {};
                    }),
                };
                return cb(manager);
            });

            await repository.saveOrderWithMarkets(order, marketIds);

            expect(mockOrderMarketRepo.save).toHaveBeenCalledTimes(3);
            expect(mockOrderMarketRepo.save).toHaveBeenCalledWith({
                orderId: "saved-order-id",
                marketId: "market-1",
            });
            expect(mockOrderMarketRepo.save).toHaveBeenCalledWith({
                orderId: "saved-order-id",
                marketId: "market-2",
            });
            expect(mockOrderMarketRepo.save).toHaveBeenCalledWith({
                orderId: "saved-order-id",
                marketId: "market-3",
            });
        });

        it("should propagate transaction errors", async () => {
            const order = createMockOrder();
            dataSource.transaction.mockRejectedValue(
                new Error("Transaction failed"),
            );

            await expect(
                repository.saveOrderWithMarkets(order, [MOCK_IDS.marketId]),
            ).rejects.toThrow("Transaction failed");
        });
    });

    describe("getOrCreateAccount", () => {
        it("should return existing account", async () => {
            const existingAccount = createMockAccount();
            accountRepository.findOne.mockResolvedValue(existingAccount);

            const result = await repository.getOrCreateAccount(
                MOCK_IDS.walletAddress,
                MOCK_IDS.privyUserId,
            );

            expect(result).toEqual(existingAccount);
            expect(accountRepository.findOne).toHaveBeenCalledWith({
                where: { userWallet: MOCK_IDS.walletAddress },
            });
            expect(accountRepository.create).not.toHaveBeenCalled();
        });

        it("should create new account when not found", async () => {
            const newAccount = createMockAccount();
            accountRepository.findOne.mockResolvedValue(null);
            accountRepository.create.mockReturnValue(newAccount);
            accountRepository.save.mockResolvedValue(newAccount);

            const result = await repository.getOrCreateAccount(
                MOCK_IDS.walletAddress,
                MOCK_IDS.privyUserId,
            );

            expect(result).toEqual(newAccount);
            expect(accountRepository.create).toHaveBeenCalledWith({
                userWallet: MOCK_IDS.walletAddress,
                privyUserId: MOCK_IDS.privyUserId,
            });
            expect(accountRepository.save).toHaveBeenCalledWith(newAccount);
        });

        it("should set privyUserId on new account", async () => {
            const customPrivyId = "did:privy:custom-id";
            const newAccount = createMockAccount({
                privyUserId: customPrivyId,
            });
            accountRepository.findOne.mockResolvedValue(null);
            accountRepository.create.mockReturnValue(newAccount);
            accountRepository.save.mockResolvedValue(newAccount);

            await repository.getOrCreateAccount(
                MOCK_IDS.walletAddress,
                customPrivyId,
            );

            expect(accountRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({ privyUserId: customPrivyId }),
            );
        });
    });

    describe("getBestRates", () => {
        it("should return highest bid and lowest ask per asset", async () => {
            const mockQb = {
                select: jest.fn().mockReturnThis(),
                addSelect: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                setParameters: jest.fn().mockReturnThis(),
                groupBy: jest.fn().mockReturnThis(),
                getRawMany: jest.fn().mockResolvedValue([
                    {
                        assetId: MOCK_IDS.assetId,
                        highestBorrow: "750",
                        lowestLend: "500",
                    },
                ]),
            };

            // Override createQueryBuilder on the repository instance
            jest.spyOn(repository, "createQueryBuilder").mockReturnValue(
                mockQb as any,
            );

            const result = await repository.getBestRates();

            expect(result).toBeInstanceOf(Map);
            expect(result.get(MOCK_IDS.assetId)).toEqual({
                borrow: 750,
                lend: 500,
            });
        });

        it("should handle no open orders (empty map)", async () => {
            const mockQb = {
                select: jest.fn().mockReturnThis(),
                addSelect: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                setParameters: jest.fn().mockReturnThis(),
                groupBy: jest.fn().mockReturnThis(),
                getRawMany: jest.fn().mockResolvedValue([]),
            };

            jest.spyOn(repository, "createQueryBuilder").mockReturnValue(
                mockQb as any,
            );

            const result = await repository.getBestRates();

            expect(result).toBeInstanceOf(Map);
            expect(result.size).toBe(0);
        });

        it("should return 0 for missing bid/ask values", async () => {
            const mockQb = {
                select: jest.fn().mockReturnThis(),
                addSelect: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                setParameters: jest.fn().mockReturnThis(),
                groupBy: jest.fn().mockReturnThis(),
                getRawMany: jest.fn().mockResolvedValue([
                    {
                        assetId: MOCK_IDS.assetId,
                        highestBorrow: null,
                        lowestLend: null,
                    },
                ]),
            };

            jest.spyOn(repository, "createQueryBuilder").mockReturnValue(
                mockQb as any,
            );

            const result = await repository.getBestRates();

            expect(result.get(MOCK_IDS.assetId)).toEqual({
                lend: 0,
                borrow: 0,
            });
        });
    });

    describe("getOpenOrders", () => {
        it("should return open orders for assetId", async () => {
            const orders = [
                createMockOrder(),
                createMockOrder({ id: "order-2" }),
            ];
            jest.spyOn(repository, "find").mockResolvedValue(orders);

            const result = await repository.getOpenOrders(MOCK_IDS.assetId);

            expect(result).toEqual(orders);
            expect(repository.find).toHaveBeenCalledWith({
                where: {
                    status: OrderStatus.Open,
                    assetId: MOCK_IDS.assetId,
                },
            });
        });

        it("should return all open orders when no assetId", async () => {
            const orders = [createMockOrder()];
            jest.spyOn(repository, "find").mockResolvedValue(orders);

            const result = await repository.getOpenOrders();

            expect(result).toEqual(orders);
            expect(repository.find).toHaveBeenCalledWith({
                where: {
                    status: OrderStatus.Open,
                    assetId: undefined,
                },
            });
        });
    });

    describe("findAccountByWallet", () => {
        it("should find account case-insensitively", async () => {
            const account = createMockAccount();
            const mockQb = {
                where: jest.fn().mockReturnThis(),
                getOne: jest.fn().mockResolvedValue(account),
            };
            accountRepository.createQueryBuilder.mockReturnValue(mockQb as any);

            const result = await repository.findAccountByWallet(
                MOCK_IDS.walletAddress,
            );

            expect(result).toEqual(account);
            expect(mockQb.where).toHaveBeenCalledWith(
                "LOWER(account.user_wallet) = LOWER(:walletAddress)",
                { walletAddress: MOCK_IDS.walletAddress },
            );
        });

        it("should return null when not found", async () => {
            const mockQb = {
                where: jest.fn().mockReturnThis(),
                getOne: jest.fn().mockResolvedValue(null),
            };
            accountRepository.createQueryBuilder.mockReturnValue(mockQb as any);

            const result = await repository.findAccountByWallet(
                "0xNonExistentWallet",
            );

            expect(result).toBeNull();
        });
    });
});
