import { DatabaseService } from "../../../core/database/database.service";

describe("DatabaseService", () => {
    let service: DatabaseService;
    let mockClient: { query: jest.Mock; release: jest.Mock };
    let mockPool: { connect: jest.Mock; end: jest.Mock };

    beforeEach(() => {
        mockClient = {
            query: jest.fn(),
            release: jest.fn(),
        };
        mockPool = {
            connect: jest.fn().mockResolvedValue(mockClient),
            end: jest.fn().mockResolvedValue(undefined),
        };

        service = new DatabaseService();
        // Inject mock pool via reflection since onModuleInit creates the real pool
        (service as any).pool = mockPool;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("query", () => {
        it("should execute query and return rows", async () => {
            const mockRows = [{ id: 1, name: "test" }];
            mockClient.query.mockResolvedValue({ rows: mockRows });

            const result = await service.query("SELECT * FROM users");

            expect(result).toEqual(mockRows);
            expect(mockClient.query).toHaveBeenCalledWith(
                "SELECT * FROM users",
                undefined,
            );
            expect(mockClient.release).toHaveBeenCalled();
        });

        it("should pass parameters to query", async () => {
            mockClient.query.mockResolvedValue({ rows: [] });

            await service.query("SELECT * FROM users WHERE id = $1", [1]);

            expect(mockClient.query).toHaveBeenCalledWith(
                "SELECT * FROM users WHERE id = $1",
                [1],
            );
        });

        it("should release client even when query throws", async () => {
            mockClient.query.mockRejectedValue(new Error("Query failed"));

            await expect(service.query("BAD SQL")).rejects.toThrow(
                "Query failed",
            );

            expect(mockClient.release).toHaveBeenCalled();
        });

        it("should return empty array when no rows", async () => {
            mockClient.query.mockResolvedValue({ rows: [] });

            const result = await service.query("SELECT * FROM empty_table");

            expect(result).toEqual([]);
        });
    });

    describe("queryOne", () => {
        it("should return first row when results exist", async () => {
            const mockRows = [{ id: 1 }, { id: 2 }];
            mockClient.query.mockResolvedValue({ rows: mockRows });

            const result = await service.queryOne(
                "SELECT * FROM users LIMIT 1",
            );

            expect(result).toEqual({ id: 1 });
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
        it("should build correct INSERT SQL and return result", async () => {
            const insertedRow = { id: 1, name: "Alice", age: 30 };
            mockClient.query.mockResolvedValue({ rows: [insertedRow] });

            const result = await service.insert("users", {
                name: "Alice",
                age: 30,
            });

            expect(result).toEqual(insertedRow);
            expect(mockClient.query).toHaveBeenCalledWith(
                "INSERT INTO users (name, age) VALUES ($1, $2) RETURNING *",
                ["Alice", 30],
            );
        });

        it("should handle single column insert", async () => {
            mockClient.query.mockResolvedValue({
                rows: [{ id: 1, email: "a@b.com" }],
            });

            await service.insert("emails", { email: "a@b.com" });

            expect(mockClient.query).toHaveBeenCalledWith(
                "INSERT INTO emails (email) VALUES ($1) RETURNING *",
                ["a@b.com"],
            );
        });

        it("should handle multiple columns", async () => {
            mockClient.query.mockResolvedValue({ rows: [{ id: 1 }] });

            await service.insert("deposit_wallets", {
                wallet_address: "0x123",
                paired_wallet_address: "0x456",
                paired_wallet_primary_key: "0xkey",
            });

            expect(mockClient.query).toHaveBeenCalledWith(
                "INSERT INTO deposit_wallets (wallet_address, paired_wallet_address, paired_wallet_primary_key) VALUES ($1, $2, $3) RETURNING *",
                ["0x123", "0x456", "0xkey"],
            );
        });
    });

    describe("getPool", () => {
        it("should return the pool instance", () => {
            expect(service.getPool()).toBe(mockPool);
        });
    });

    describe("onModuleDestroy", () => {
        it("should close the pool", async () => {
            await service.onModuleDestroy();

            expect(mockPool.end).toHaveBeenCalled();
        });
    });
});
