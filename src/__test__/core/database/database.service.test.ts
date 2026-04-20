import { DatabaseService } from "../../../core/database/database.service";

const mockClient = {
    query: jest.fn(),
    release: jest.fn(),
};

const mockPool = {
    connect: jest.fn().mockResolvedValue(mockClient),
    end: jest.fn().mockResolvedValue(undefined),
};

jest.mock("pg", () => ({
    Pool: jest.fn(() => mockPool),
}));

describe("DatabaseService", () => {
    let service: DatabaseService;

    beforeEach(async () => {
        jest.clearAllMocks();
        service = new DatabaseService();
        await service.onModuleInit();
    });

    describe("lifecycle", () => {
        it("should initialize Pool on onModuleInit", () => {
            const { Pool } = require("pg");
            expect(Pool).toHaveBeenCalledWith({
                connectionString: process.env.DATABASE_URL,
            });
        });

        it("should end Pool on onModuleDestroy", async () => {
            await service.onModuleDestroy();
            expect(mockPool.end).toHaveBeenCalled();
        });
    });

    describe("getPool", () => {
        it("should return the pool instance", () => {
            expect(service.getPool()).toBeDefined();
        });
    });

    describe("query", () => {
        it("should acquire client, execute query, and release client", async () => {
            const mockRows = [{ id: 1, name: "test" }];
            mockClient.query.mockResolvedValueOnce({ rows: mockRows });

            const result = await service.query("SELECT * FROM users");

            expect(mockPool.connect).toHaveBeenCalled();
            expect(mockClient.query).toHaveBeenCalledWith(
                "SELECT * FROM users",
                undefined,
            );
            expect(mockClient.release).toHaveBeenCalled();
            expect(result).toEqual(mockRows);
        });

        it("should release client even when query throws", async () => {
            mockClient.query.mockRejectedValueOnce(new Error("DB error"));

            await expect(
                service.query("SELECT * FROM bad_table"),
            ).rejects.toThrow("DB error");

            expect(mockClient.release).toHaveBeenCalled();
        });

        it("should pass params to client.query", async () => {
            mockClient.query.mockResolvedValueOnce({ rows: [] });

            await service.query("SELECT * FROM users WHERE id = $1", [42]);

            expect(mockClient.query).toHaveBeenCalledWith(
                "SELECT * FROM users WHERE id = $1",
                [42],
            );
        });
    });

    describe("queryOne", () => {
        it("should return first row when results exist", async () => {
            const mockRows = [
                { id: 1, name: "first" },
                { id: 2, name: "second" },
            ];
            mockClient.query.mockResolvedValueOnce({ rows: mockRows });

            const result = await service.queryOne(
                "SELECT * FROM users LIMIT 1",
            );

            expect(result).toEqual({ id: 1, name: "first" });
        });

        it("should return null when no results", async () => {
            mockClient.query.mockResolvedValueOnce({ rows: [] });

            const result = await service.queryOne(
                "SELECT * FROM users WHERE id = $1",
                [999],
            );

            expect(result).toBeNull();
        });
    });

    describe("insert", () => {
        it("should construct INSERT SQL with correct columns, placeholders, and RETURNING *", async () => {
            const mockRow = { id: 1, name: "test", email: "test@test.com" };
            mockClient.query.mockResolvedValueOnce({ rows: [mockRow] });

            const result = await service.insert("users", {
                name: "test",
                email: "test@test.com",
            });

            expect(mockClient.query).toHaveBeenCalledWith(
                "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *",
                ["test", "test@test.com"],
            );
            expect(result).toEqual(mockRow);
        });

        it("should parameterize values in correct order", async () => {
            mockClient.query.mockResolvedValueOnce({
                rows: [{ id: 1, a: "x", b: "y", c: "z" }],
            });

            await service.insert("test_table", {
                a: "x",
                b: "y",
                c: "z",
            });

            expect(mockClient.query).toHaveBeenCalledWith(
                "INSERT INTO test_table (a, b, c) VALUES ($1, $2, $3) RETURNING *",
                ["x", "y", "z"],
            );
        });
    });
});
