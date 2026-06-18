import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { MatchRepository } from "../../orders/repositories/match.repository";

describe("MatchRepository", () => {
    let repository: MatchRepository;
    let queryBuilder: {
        select: jest.Mock;
        addSelect: jest.Mock;
        where: jest.Mock;
        andWhere: jest.Mock;
        getRawMany: jest.Mock;
    };

    beforeEach(async () => {
        queryBuilder = {
            select: jest.fn().mockReturnThis(),
            addSelect: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            getRawMany: jest.fn(),
        };

        const mockEntityManager = { getRepository: jest.fn() };
        const mockDataSource = {
            createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MatchRepository,
                { provide: DataSource, useValue: mockDataSource },
            ],
        }).compile();

        repository = module.get<MatchRepository>(MatchRepository);
        // Override the inherited createQueryBuilder so we don't need a real
        // EntityManager backing it.
        repository.createQueryBuilder = jest
            .fn()
            .mockReturnValue(queryBuilder) as any;
    });

    describe("getPendingBorrowMatches", () => {
        const accountId = "acc-uuid-1";

        it("filters by borrower_account_id and settlement_status = PENDING", async () => {
            queryBuilder.getRawMany.mockResolvedValue([
                { assetId: "asset-uuid-1", matchAmount: "100" },
            ]);

            const rows = await repository.getPendingBorrowMatches(accountId);

            expect(repository.createQueryBuilder).toHaveBeenCalledWith("m");
            expect(queryBuilder.select).toHaveBeenCalledWith(
                "m.asset_id",
                "assetId",
            );
            expect(queryBuilder.addSelect).toHaveBeenCalledWith(
                "m.match_amount",
                "matchAmount",
            );
            expect(queryBuilder.where).toHaveBeenCalledWith(
                "m.borrower_account_id = :accountId",
                { accountId },
            );
            expect(queryBuilder.andWhere).toHaveBeenCalledWith(
                "m.settlement_status = :status",
                { status: "PENDING" },
            );
            expect(rows).toEqual([
                { assetId: "asset-uuid-1", matchAmount: "100" },
            ]);
        });

        it("returns an empty array when no pending matches exist", async () => {
            queryBuilder.getRawMany.mockResolvedValue([]);

            const rows = await repository.getPendingBorrowMatches(accountId);

            expect(rows).toEqual([]);
        });

        it("returns multiple rows verbatim from the query builder", async () => {
            const expected = [
                { assetId: "asset-uuid-1", matchAmount: "100" },
                { assetId: "asset-uuid-2", matchAmount: "250" },
            ];
            queryBuilder.getRawMany.mockResolvedValue(expected);

            const rows = await repository.getPendingBorrowMatches(accountId);

            expect(rows).toEqual(expected);
        });
    });
});
