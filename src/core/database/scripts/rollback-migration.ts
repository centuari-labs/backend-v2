import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import "dotenv/config";

async function rollbackLastMigration() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    const { rows } = await client.query(
        "SELECT * FROM migrations_log ORDER BY executed_at DESC LIMIT 1",
    );
    if (rows.length === 0) {
        console.log("ℹ️ No migrations to rollback.");
        process.exit(0);
    }

    const last = rows[0];
    const file = last.filename;
    console.log(`🕐 Rolling back: ${file}`);

    const sqlPath = join(__dirname, "../migrations", file);
    const content = readFileSync(sqlPath, "utf8");
    const downPart = content.split("-- +goose Down")[1];
    if (!downPart) {
        console.error(`❌ No rollback section found in ${file}`);
        process.exit(1);
    }

    try {
        await client.query("BEGIN");
        await client.query(downPart);
        await client.query("DELETE FROM migrations_log WHERE filename = $1", [
            file,
        ]);
        await client.query("COMMIT");
        console.log(`✅ Rolled back: ${file}`);
    } catch (err) {
        await client.query("ROLLBACK");
        console.error(`❌ Rollback failed: ${err.message}`);
        process.exit(1);
    }

    await client.end();
}

rollbackLastMigration().catch((e) => {
    console.error(e);
    process.exit(1);
});
