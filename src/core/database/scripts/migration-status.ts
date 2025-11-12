import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import "dotenv/config";

async function showStatus() {
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
    const allFiles = readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort();

    const { rows } = await client.query("SELECT filename FROM migrations_log");
    const executed = rows.map((r) => r.filename);

    console.log("📜 Migration Status:\n");
    for (const f of allFiles) {
        const status = executed.includes(f) ? "✅ Done" : "❌ Pending";
        console.log(`${status}  ${f}`);
    }

    await client.end();
}

showStatus().catch((e) => {
    console.error(e);
    process.exit(1);
});
