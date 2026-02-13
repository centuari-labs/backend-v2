import { join } from "node:path";
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";

export async function runSeeds() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    const dir = join(__dirname, "../seeds");
    const files = readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort();

    if (files.length === 0) {
        console.log("ℹ️ No seeds found.");
        return;
    }

    for (const file of files) {
        const sql = readFileSync(join(dir, file), "utf8");
        console.log(`🌱 Running seed: ${file}`);
        try {
            await client.query("BEGIN");
            await client.query(sql);
            await client.query("COMMIT");
            console.log(`✅ Seed ${file} executed successfully.`);
        } catch (err) {
            await client.query("ROLLBACK");
            console.error(`❌ Error executing ${file}:`, err.message);
        }
    }

    await client.end();
    console.log("🎉 All seeds executed!");
}

// Run when executed directly (e.g. pnpm db seed:run)
if (process.argv[1]?.includes("run-seed")) {
    runSeeds().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
