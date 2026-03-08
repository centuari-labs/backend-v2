import { readFileSync } from "node:fs";
import { join } from "node:path";
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { getMigrationsDir } from "./migrations-dir";

async function resetMigrations() {
    console.log("🧨 Resetting all migrations...");

    const client = new Client({
        connectionString: process.env.DATABASE_URL,
    });

    await client.connect();

    // Pastikan table migrations_log ada
    await client.query(`
    CREATE TABLE IF NOT EXISTS migrations_log (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP DEFAULT NOW()
    );
  `);

    // Ambil semua migration yang sudah dijalankan (descending)
    const { rows } = await client.query(
        "SELECT filename FROM migrations_log ORDER BY executed_at DESC",
    );

    if (rows.length === 0) {
        console.log("No migrations to reset. Database is clean.");
        await client.end();
        return;
    }

    console.log(`Found ${rows.length} applied migrations.`);
    console.log("Rolling back all migrations...");

    for (const row of rows) {
        const file = row.filename;
        const filePath = join(getMigrationsDir(__dirname), file);

        try {
            const content = readFileSync(filePath, "utf8");
            const downPart = content.split("-- +goose Down")[1];

            if (!downPart) {
                console.log(`⚠️ No rollback section for ${file}, skipping...`);
                continue;
            }

            await client.query("BEGIN");
            await client.query(downPart);
            await client.query(
                "DELETE FROM migrations_log WHERE filename = $1",
                [file],
            );
            await client.query("COMMIT");

            console.log(`✔ Rolled back: ${file}`);
        } catch (err) {
            await client.query("ROLLBACK");
            console.error(`❌ Error rolling back ${file}:`, err.message);
            process.exit(1);
        }
    }

    await client.end();
    console.log("✅ All migrations rolled back.");

    // Jalankan migration lagi dari awal
    console.log("🚀 Re-running all migrations...");
    const result = spawnSync("pnpm", ["db", "up"], { stdio: "inherit" });

    if (result.status === 0) {
        console.log("🎉 Migration reset complete!");
    } else {
        console.log("❌ Migration reset failed.");
    }
}

resetMigrations().catch((err) => {
    console.error("❌ Reset failed:", err);
    process.exit(1);
});
