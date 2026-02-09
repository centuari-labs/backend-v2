import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import "dotenv/config";

export async function runMigrations() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    await client.query(`
    CREATE TABLE IF NOT EXISTS migrations_log (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP DEFAULT NOW()
    );
  `);

    const dir = join(__dirname, "../migrations");
    const files = readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort();

    for (const file of files) {
        const { rows } = await client.query(
            "SELECT * FROM migrations_log WHERE filename = $1",
            [file],
        );
        if (rows.length > 0) {
            console.log(`⏩ Skipping: ${file}`);
            continue;
        }

        const sql = readFileSync(join(dir, file), "utf8");
        const upPart = sql.split("-- +goose Down")[0].split("-- +goose Up")[1];
        console.log(`📄 Running: ${file}`);

        try {
            await client.query("BEGIN");
            await client.query(upPart);
            await client.query(
                "INSERT INTO migrations_log (filename) VALUES ($1)",
                [file],
            );
            await client.query("COMMIT");
            console.log(`✅ Success: ${file}`);
        } catch (err) {
            await client.query("ROLLBACK");
            console.error(`❌ Failed: ${file}`, err.message);
            process.exit(1);
        }
    }

    await client.end();
    console.log("🎉 All migrations executed!");
}

// Run when executed directly (e.g. pnpm db up)
if (process.argv[1]?.includes("run-migration")) {
    runMigrations().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
