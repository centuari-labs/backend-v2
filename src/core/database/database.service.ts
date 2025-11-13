import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Injectable, Logger } from "@nestjs/common";
import { Pool } from "pg";
import "dotenv/config";

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(DatabaseService.name);
    private pool: Pool;

    async onModuleInit() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
        });
        this.logger.log("Database connection pool initialized");
    }

    async onModuleDestroy() {
        await this.pool.end();
        this.logger.log("Database connection pool closed");
    }

    getPool(): Pool {
        return this.pool;
    }

    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
        const client = await this.pool.connect();
        try {
            const result = await client.query(text, params);
            return result.rows;
        } finally {
            client.release();
        }
    }

    async queryOne<T>(text: string, params?: unknown[]): Promise<T | null> {
        const rows = await this.query<T>(text, params);
        return rows.length > 0 ? rows[0] : null;
    }

    async insert<T>(table: string, data: Record<string, unknown>): Promise<T> {
        const keys = Object.keys(data);
        const values = Object.values(data);
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
        const columns = keys.join(", ");

        const text = `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`;
        const rows = await this.query<T>(text, values);
        return rows[0];
    }
}
