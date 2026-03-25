jest.mock("pg", () => {
    const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
    };
    const mockPool = {
        connect: jest.fn().mockResolvedValue(mockClient),
        end: jest.fn().mockResolvedValue(undefined),
        _mockClient: mockClient,
    };
    return { Pool: jest.fn(() => mockPool) };
});

import { Test, TestingModule } from "@nestjs/testing";
import { DatabaseService } from "../../../core/database/database.service";

describe("DatabaseService", () => {
    let service: DatabaseService;
    let mockPool: any;
    let mockClient: any;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [DatabaseService],
        }).compile();

        service = module.get<DatabaseService>(DatabaseService);
        await service.onModuleInit();

        mockPool = (service as any).pool;
        mockClient = mockPool._mockClient;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("query", () => {
        it("should return rows from query result", async () => {
            const mockRows = [
                { id: 1, name: "test" },
                { id: 2, name: "test2" },
            ];
            mockClient.query.mockResolvedValue({ rows: mockRows });

            const result = await service.query("SELECT * FROM users");

            expect(result).toEqual(mockRows);
            expect(mockClient.query).toHaveBeenCalledWith(
                "SELECT * FROM users",
                undefined,
            );
        });

        it("should pass params to query", async () => {
            mockClient.query.mockResolvedValue({ rows: [] });

            await service.query("SELECT * FROM users WHERE id = $1", [1]);

            expect(mockClient.query).toHaveBeenCalledWith(
                "SELECT * FROM users WHERE id = $1",
                [1],
            );
        });

        it("should release client after successful query", async () => {
            mockClient.query.mockResolvedValue({ rows: [] });

            await service.query("SELECT 1");

            expect(mockClient.release).toHaveBeenCalled();
        });

        it("should release client even on query error", async () => {
            mockClient.query.mockRejectedValue(new Error("Query failed"));

            await expect(service.query("BAD SQL")).rejects.toThrow(
                "Query failed",
            );
            expect(mockClient.release).toHaveBeenCalled();
        });
    });

    describe("queryOne", () => {
        it("should return first row when results exist", async () => {
            const mockRows = [{ id: 1, name: "test" }];
            mockClient.query.mockResolvedValue({ rows: mockRows });

            const result = await service.queryOne(
                "SELECT * FROM users LIMIT 1",
            );

            expect(result).toEqual({ id: 1, name: "test" });
        });

        it("should return null when no results", async () => {
            mockClient.query.mockResolvedValue({ rows: [] });

            const result = await service.queryOne(
                "SELECT * FROM users WHERE id = $1",
                [999],
            );

            expect(result).toBeNull();
        });
    });

    describe("insert", () => {
        it("should build correct INSERT SQL and return inserted row", async () => {
            const insertedRow = {
                id: 1,
                name: "test",
                email: "test@example.com",
            };
            mockClient.query.mockResolvedValue({ rows: [insertedRow] });

            const result = await service.insert("users", {
                name: "test",
                email: "test@example.com",
            });

            expect(result).toEqual(insertedRow);
            expect(mockClient.query).toHaveBeenCalledWith(
                "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *",
                ["test", "test@example.com"],
            );
        });

        it("should handle single-column insert", async () => {
            mockClient.query.mockResolvedValue({
                rows: [{ id: 1, name: "solo" }],
            });

            await service.insert("users", { name: "solo" });

            expect(mockClient.query).toHaveBeenCalledWith(
                "INSERT INTO users (name) VALUES ($1) RETURNING *",
                ["solo"],
            );
        });
    });

    describe("getPool", () => {
        it("should return the pool instance", () => {
            expect(service.getPool()).toBe(mockPool);
        });
    });

    describe("lifecycle", () => {
        it("should end pool on module destroy", async () => {
            await service.onModuleDestroy();

            expect(mockPool.end).toHaveBeenCalled();
        });
    });
});
