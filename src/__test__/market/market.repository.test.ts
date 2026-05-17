import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { Market } from "../../market/entities/market.entity";
import { MarketRepositories } from "../../market/repository/market.repository";
import { computeMarketId as computeLegacyMarketUuid } from "../../market/utils/market-id.utils";
import { uuidToBytes32 } from "../../common/utils/uuid.utils";
import { LendPosition } from "../../portfolio/entities/lend-position.entity";
import { UserBalance } from "../../portfolio/entities/user-balance.entity";

interface MockQb {
    innerJoin: jest.Mock;
    select: jest.Mock;
    addSelect: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    groupBy: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
    distinctOn: jest.Mock;
    limit: jest.Mock;
    getRawMany: jest.Mock;
    getRawOne: jest.Mock;
}

interface MockInsertQb {
    insert: jest.Mock;
    into: jest.Mock;
    values: jest.Mock;
    orIgnore: jest.Mock;
    execute: jest.Mock;
}

function createMockQb(): MockQb {
    return {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        distinctOn: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn(),
        getRawOne: jest.fn(),
    };
}

function createMockInsertQb(): MockInsertQb {
    return {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orIgnore: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ identifiers: [] }),
    };
}

const LOAN_TOKEN_USDC = "0x1111111111111111111111111111111111111111";
const LOAN_TOKEN_USDT = "0x2222222222222222222222222222222222222222";
const MATURITY_A = 1735689600; // 2024-12-31
const MATURITY_B = 1740000000;

const MARKET_UUID_A = computeLegacyMarketUuid(LOAN_TOKEN_USDC, MATURITY_A);
const MARKET_UUID_B = computeLegacyMarketUuid(LOAN_TOKEN_USDT, MATURITY_B);
const MARKET_HEX_A = uuidToBytes32(MARKET_UUID_A);
const MARKET_HEX_B = uuidToBytes32(MARKET_UUID_B);
const MARKET_ID_BUF_A = Buffer.from(MARKET_HEX_A.slice(2), "hex");
const MARKET_ID_BUF_B = Buffer.from(MARKET_HEX_B.slice(2), "hex");

describe("MarketRepositories", () => {
    let repository: MarketRepositories;
    let ubQb: MockQb;
    let lpQb: MockQb;
    let mQb: MockQb;
    let mInsertQb: MockInsertQb;
    let userBalanceRepo: { createQueryBuilder: jest.Mock };
    let lendRepo: { createQueryBuilder: jest.Mock };
    let marketRepo: { createQueryBuilder: jest.Mock };

    beforeEach(async () => {
        ubQb = createMockQb();
        lpQb = createMockQb();
        mQb = createMockQb();
        mInsertQb = createMockInsertQb();
        userBalanceRepo = {
            createQueryBuilder: jest.fn().mockReturnValue(ubQb),
        };
        lendRepo = { createQueryBuilder: jest.fn().mockReturnValue(lpQb) };
        marketRepo = {
            createQueryBuilder: jest
                .fn()
                .mockImplementation((alias?: string) =>
                    alias ? mQb : mInsertQb,
                ),
        };

        const mockEntityManager = { getRepository: jest.fn() };
        const mockDataSource = {
            createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MarketRepositories,
                { provide: DataSource, useValue: mockDataSource },
                {
                    provide: getRepositoryToken(UserBalance),
                    useValue: userBalanceRepo,
                },
                {
                    provide: getRepositoryToken(LendPosition),
                    useValue: lendRepo,
                },
                {
                    provide: getRepositoryToken(Market),
                    useValue: marketRepo,
                },
            ],
        }).compile();

        repository = module.get<MarketRepositories>(MarketRepositories);
    });

    describe("getMarketsByIds", () => {
        it("returns [] for empty input without hitting the repo", async () => {
            const result = await repository.getMarketsByIds([]);
            expect(result).toEqual([]);
            expect(marketRepo.createQueryBuilder).not.toHaveBeenCalled();
        });

        it("translates UUID input via uuidToBytes32, joins market→assets, decodes BYTEA market_id back to UUID, maps maturity bigint→Date", async () => {
            const createdAt = new Date("2024-01-01T00:00:00.000Z");
            mQb.getRawMany.mockResolvedValue([
                {
                    market_id: MARKET_ID_BUF_A,
                    asset_id: "uuid-usdc",
                    maturity: MATURITY_A.toString(),
                    created_at: createdAt,
                },
            ]);

            const result = await repository.getMarketsByIds([MARKET_UUID_A]);

            expect(marketRepo.createQueryBuilder).toHaveBeenCalledWith("m");
            expect(mQb.innerJoin).toHaveBeenCalledWith(
                expect.anything(),
                "t",
                "LOWER(t.token_address) = '0x' || encode(m.loan_token, 'hex')",
            );
            // BYTEA where-clause params are Buffers, not hex strings
            const whereCall = mQb.where.mock.calls[0];
            expect(whereCall[0]).toBe("m.market_id IN (:...byteaIds)");
            expect(whereCall[1].byteaIds[0]).toBeInstanceOf(Buffer);
            expect((whereCall[1].byteaIds[0] as Buffer).toString("hex")).toBe(
                MARKET_HEX_A.slice(2),
            );

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe(MARKET_UUID_A);
            expect(result[0].assetId).toBe("uuid-usdc");
            expect(result[0].maturity?.getTime()).toBe(MATURITY_A * 1000);
            expect(result[0].createdAt).toBe(createdAt);
        });
    });

    describe("getTotalDepositUsd", () => {
        // 3 wallets × 2 assets fixture (interpreted by Postgres SUM):
        //   wallet1, BTC: available=100, in_orders=50, in_yield=0     => 150
        //   wallet2, BTC: available=80,  in_orders=20, in_yield=50    => 150
        //   wallet3, ETH: available=1000, in_orders=0, in_yield=0     => 1000
        //   wallet1, ETH: available=2000, in_orders=0, in_yield=2000  => 4000
        // Per-asset totals: BTC = 300, ETH = 5000.
        it("joins user_balance to token via hex↔bytea bridge and sums all three balance buckets per asset", async () => {
            const expected = [
                { asset_id: "uuid-btc", total_amount: "300" },
                { asset_id: "uuid-eth", total_amount: "5000" },
            ];
            ubQb.getRawMany.mockResolvedValue(expected);

            const result = await repository.getTotalDepositUsd();

            expect(userBalanceRepo.createQueryBuilder).toHaveBeenCalledWith(
                "ub",
            );
            expect(ubQb.innerJoin).toHaveBeenCalledWith(
                expect.anything(),
                "t",
                "LOWER(t.token_address) = '0x' || encode(ub.asset, 'hex')",
            );
            expect(ubQb.select).toHaveBeenCalledWith("t.id", "asset_id");
            expect(ubQb.addSelect).toHaveBeenCalledWith(
                "SUM(ub.available + ub.in_orders + ub.in_yield_router)::text",
                "total_amount",
            );
            expect(ubQb.groupBy).toHaveBeenCalledWith("t.id");
            expect(result).toEqual(expected);
        });

        it("returns an empty array when no rows exist", async () => {
            ubQb.getRawMany.mockResolvedValue([]);
            const result = await repository.getTotalDepositUsd();
            expect(result).toEqual([]);
        });
    });

    describe("getActiveLoans", () => {
        it("joins lend_position → market → token and sums principal per asset, filtering cbt_balance > 0", async () => {
            const expected = [
                { asset_id: "uuid-usdc", total_amount: "1000000" },
            ];
            lpQb.getRawMany.mockResolvedValue(expected);

            const result = await repository.getActiveLoans();

            expect(lendRepo.createQueryBuilder).toHaveBeenCalledWith("lp");
            expect(lpQb.innerJoin).toHaveBeenNthCalledWith(
                1,
                expect.anything(),
                "m",
                "m.market_id = lp.market_id",
            );
            expect(lpQb.innerJoin).toHaveBeenNthCalledWith(
                2,
                expect.anything(),
                "t",
                "LOWER(t.token_address) = '0x' || encode(m.loan_token, 'hex')",
            );
            expect(lpQb.select).toHaveBeenCalledWith("t.id", "asset_id");
            expect(lpQb.addSelect).toHaveBeenCalledWith(
                "SUM(lp.principal)::text",
                "total_amount",
            );
            expect(lpQb.where).toHaveBeenCalledWith("lp.cbt_balance > 0");
            expect(lpQb.groupBy).toHaveBeenCalledWith("t.id");
            expect(result).toEqual(expected);
        });
    });

    describe("getEarliestMarketByAssetIds", () => {
        it("returns [] for empty input without hitting the repo", async () => {
            const result = await repository.getEarliestMarketByAssetIds([]);
            expect(result).toEqual([]);
            expect(marketRepo.createQueryBuilder).not.toHaveBeenCalled();
        });

        it("DISTINCT ON loan_token ordered by maturity ASC, joins assets, filters by minMaturity unix seconds", async () => {
            const minMaturity = new Date("2024-01-01T00:00:00.000Z");
            const expectedMinUnix = Math.floor(minMaturity.getTime() / 1000);
            mQb.getRawMany.mockResolvedValue([
                {
                    asset_id: "uuid-usdc",
                    market_id: MARKET_ID_BUF_A,
                    maturity: MATURITY_A.toString(),
                },
            ]);

            const result = await repository.getEarliestMarketByAssetIds(
                ["uuid-usdc"],
                minMaturity,
            );

            expect(mQb.distinctOn).toHaveBeenCalledWith(["m.loan_token"]);
            expect(mQb.where).toHaveBeenCalledWith("t.id IN (:...assetIds)", {
                assetIds: ["uuid-usdc"],
            });
            expect(mQb.andWhere).toHaveBeenCalledWith("m.maturity >= :min", {
                min: expectedMinUnix.toString(),
            });
            expect(mQb.orderBy).toHaveBeenCalledWith("m.loan_token", "ASC");
            expect(mQb.addOrderBy).toHaveBeenCalledWith("m.maturity", "ASC");
            expect(result).toEqual([
                {
                    assetId: "uuid-usdc",
                    marketId: MARKET_UUID_A,
                    maturity: new Date(MATURITY_A * 1000),
                },
            ]);
        });
    });

    describe("getSumDepositByAssetId", () => {
        const assetId = "uuid-btc";

        it("filters user_balance by asset_id and sums the three balance buckets via COALESCE", async () => {
            ubQb.getRawOne.mockResolvedValue({ total_amount: "300" });

            const result = await repository.getSumDepositByAssetId(assetId);

            expect(userBalanceRepo.createQueryBuilder).toHaveBeenCalledWith(
                "ub",
            );
            expect(ubQb.innerJoin).toHaveBeenCalledWith(
                expect.anything(),
                "t",
                "LOWER(t.token_address) = '0x' || encode(ub.asset, 'hex')",
            );
            expect(ubQb.select).toHaveBeenCalledWith(
                "COALESCE(SUM(ub.available + ub.in_orders + ub.in_yield_router), 0)::text",
                "total_amount",
            );
            expect(ubQb.where).toHaveBeenCalledWith("t.id = :assetId", {
                assetId,
            });
            expect(result).toBe("300");
        });

        it("returns '0' when getRawOne resolves to undefined", async () => {
            ubQb.getRawOne.mockResolvedValue(undefined);
            const result = await repository.getSumDepositByAssetId(assetId);
            expect(result).toBe("0");
        });

        it("returns '0' when total_amount is null", async () => {
            ubQb.getRawOne.mockResolvedValue({ total_amount: null });
            const result = await repository.getSumDepositByAssetId(assetId);
            expect(result).toBe("0");
        });
    });

    describe("getSumLoansByAssetId", () => {
        const assetId = "uuid-usdc";

        it("filters lend_position by asset_id via market+token joins and cbt_balance > 0", async () => {
            lpQb.getRawOne.mockResolvedValue({ total_amount: "1000000" });

            const result = await repository.getSumLoansByAssetId(assetId);

            expect(lendRepo.createQueryBuilder).toHaveBeenCalledWith("lp");
            expect(lpQb.innerJoin).toHaveBeenNthCalledWith(
                1,
                expect.anything(),
                "m",
                "m.market_id = lp.market_id",
            );
            expect(lpQb.innerJoin).toHaveBeenNthCalledWith(
                2,
                expect.anything(),
                "t",
                "LOWER(t.token_address) = '0x' || encode(m.loan_token, 'hex')",
            );
            expect(lpQb.select).toHaveBeenCalledWith(
                "COALESCE(SUM(lp.principal), 0)::text",
                "total_amount",
            );
            expect(lpQb.where).toHaveBeenCalledWith("t.id = :assetId", {
                assetId,
            });
            expect(lpQb.andWhere).toHaveBeenCalledWith("lp.cbt_balance > 0");
            expect(result).toBe("1000000");
        });

        it("returns '0' when getRawOne resolves to undefined", async () => {
            lpQb.getRawOne.mockResolvedValue(undefined);
            const result = await repository.getSumLoansByAssetId(assetId);
            expect(result).toBe("0");
        });
    });

    describe("getMarketWithAsset", () => {
        it("returns null when the join finds nothing", async () => {
            mQb.getRawOne.mockResolvedValue(undefined);
            const result = await repository.getMarketWithAsset(MARKET_UUID_A);
            expect(result).toBeNull();
        });

        it("translates UUID input via uuidToBytes32, joins assets via loan_token, and returns maturity as ISO string", async () => {
            mQb.getRawOne.mockResolvedValue({
                maturity: MATURITY_A.toString(),
                asset_id: "uuid-usdc",
                decimals: 6,
                token_address: "0x1111111111111111111111111111111111111111",
            });

            const result = await repository.getMarketWithAsset(MARKET_UUID_A);

            const whereCall = mQb.where.mock.calls[0];
            expect(whereCall[0]).toBe("m.market_id = :marketId");
            expect(whereCall[1].marketId).toBeInstanceOf(Buffer);
            expect((whereCall[1].marketId as Buffer).toString("hex")).toBe(
                MARKET_HEX_A.slice(2),
            );

            expect(result).toEqual({
                id: MARKET_UUID_A,
                assetId: "uuid-usdc",
                maturity: new Date(MATURITY_A * 1000).toISOString(),
                decimals: 6,
                tokenAddress: "0x1111111111111111111111111111111111111111",
            });
        });
    });

    describe("getUpcomingMarkets", () => {
        beforeEach(() => {
            jest.spyOn(Date, "now").mockReturnValue(1700000000_000);
        });
        afterEach(() => {
            jest.restoreAllMocks();
        });

        it("filters by assetId, maturity > now (unix seconds), orders ASC, applies limit, decodes BYTEA market_id to UUID", async () => {
            const createdAt = new Date("2024-01-01T00:00:00.000Z");
            mQb.getRawMany.mockResolvedValue([
                {
                    market_id: MARKET_ID_BUF_A,
                    asset_id: "uuid-usdc",
                    maturity: MATURITY_A.toString(),
                    created_at: createdAt,
                },
            ]);

            const result = await repository.getUpcomingMarkets("uuid-usdc", 3);

            expect(mQb.where).toHaveBeenCalledWith("t.id = :assetId", {
                assetId: "uuid-usdc",
            });
            expect(mQb.andWhere).toHaveBeenCalledWith("m.maturity > :now", {
                now: "1700000000",
            });
            expect(mQb.orderBy).toHaveBeenCalledWith("m.maturity", "ASC");
            expect(mQb.limit).toHaveBeenCalledWith(3);

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe(MARKET_UUID_A);
            expect(result[0].assetId).toBe("uuid-usdc");
            expect(result[0].maturity?.getTime()).toBe(MATURITY_A * 1000);
            expect(result[0].createdAt).toBe(createdAt);
        });
    });

    describe("ensureMarketsForLoanToken", () => {
        it("returns [] for empty input without hitting the repo", async () => {
            const result = await repository.ensureMarketsForLoanToken(
                LOAN_TOKEN_USDC,
                [],
            );
            expect(result).toEqual([]);
            expect(marketRepo.createQueryBuilder).not.toHaveBeenCalled();
        });

        it("computes marketId via uuidToBytes32(legacyUuid), lowercases loanToken, and inserts with ON CONFLICT DO NOTHING", async () => {
            const result = await repository.ensureMarketsForLoanToken(
                LOAN_TOKEN_USDC.toUpperCase(),
                [MATURITY_A, MATURITY_B],
            );

            expect(mInsertQb.insert).toHaveBeenCalledTimes(1);
            expect(mInsertQb.into).toHaveBeenCalledWith(Market);
            expect(mInsertQb.values).toHaveBeenCalledWith([
                {
                    marketId: uuidToBytes32(
                        computeLegacyMarketUuid(LOAN_TOKEN_USDC, MATURITY_A),
                    ),
                    loanToken: LOAN_TOKEN_USDC,
                    maturity: MATURITY_A.toString(),
                },
                {
                    marketId: uuidToBytes32(
                        computeLegacyMarketUuid(LOAN_TOKEN_USDC, MATURITY_B),
                    ),
                    loanToken: LOAN_TOKEN_USDC,
                    maturity: MATURITY_B.toString(),
                },
            ]);
            expect(mInsertQb.orIgnore).toHaveBeenCalledTimes(1);
            expect(mInsertQb.execute).toHaveBeenCalledTimes(1);

            expect(result).toEqual([
                {
                    marketId: uuidToBytes32(
                        computeLegacyMarketUuid(LOAN_TOKEN_USDC, MATURITY_A),
                    ),
                    loanToken: LOAN_TOKEN_USDC,
                    maturity: MATURITY_A,
                },
                {
                    marketId: uuidToBytes32(
                        computeLegacyMarketUuid(LOAN_TOKEN_USDC, MATURITY_B),
                    ),
                    loanToken: LOAN_TOKEN_USDC,
                    maturity: MATURITY_B,
                },
            ]);
        });

        it("propagates execute() errors so the caller can retry", async () => {
            mInsertQb.execute.mockRejectedValueOnce(new Error("pg down"));
            await expect(
                repository.ensureMarketsForLoanToken(LOAN_TOKEN_USDC, [
                    MATURITY_A,
                ]),
            ).rejects.toThrow("pg down");
        });

        it("computeMarketId is deterministic and trailing 16 bytes are zero (zero-padded encoding invariant)", async () => {
            // Indirectly verify via the values passed to insert()
            await repository.ensureMarketsForLoanToken(LOAN_TOKEN_USDC, [
                MATURITY_A,
            ]);
            const passed = mInsertQb.values.mock.calls[0][0] as Array<{
                marketId: string;
            }>;
            const marketId = passed[0].marketId;
            // 0x + 64 hex chars
            expect(marketId).toMatch(/^0x[0-9a-f]{64}$/);
            // Trailing 16 bytes (32 hex chars after the first 32) are zero
            expect(marketId.slice(34)).toBe("0".repeat(32));
        });
    });
});
