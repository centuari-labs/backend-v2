import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { MarketRepositories } from "../../market/repository/market.repository";
import { LendPosition } from "../../portfolio/entities/lend-position.entity";
import { UserBalance } from "../../portfolio/entities/user-balance.entity";

interface MockQb {
    innerJoin: jest.Mock;
    select: jest.Mock;
    addSelect: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    groupBy: jest.Mock;
    getRawMany: jest.Mock;
    getRawOne: jest.Mock;
}

function createMockQb(): MockQb {
    return {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn(),
        getRawOne: jest.fn(),
    };
}

describe("MarketRepositories", () => {
    let repository: MarketRepositories;
    let ubQb: MockQb;
    let lpQb: MockQb;
    let userBalanceRepo: { createQueryBuilder: jest.Mock };
    let lendRepo: { createQueryBuilder: jest.Mock };

    beforeEach(async () => {
        ubQb = createMockQb();
        lpQb = createMockQb();
        userBalanceRepo = {
            createQueryBuilder: jest.fn().mockReturnValue(ubQb),
        };
        lendRepo = { createQueryBuilder: jest.fn().mockReturnValue(lpQb) };

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
            ],
        }).compile();

        repository = module.get<MarketRepositories>(MarketRepositories);
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
});
