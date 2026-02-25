import { join } from "node:path";
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";

export async function runSeeds(targetFile?: string) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    const dir = join(__dirname, "../seeds");
    let files: string[];

    if (targetFile) {
        // Match by exact name or partial match (e.g. "supported_tokens" matches the full filename)
        const all = readdirSync(dir).filter((f) => f.endsWith(".sql"));
        files = all.filter(
            (f) => f === targetFile || f.includes(targetFile),
        );

        if (files.length === 0) {
            console.error(`❌ No seed file matching "${targetFile}" found.`);
            console.log(
                "Available seeds:",
                all.map((f) => `  ${f}`).join("\n"),
            );
            await client.end();
            return;
        }
    } else {
        files = readdirSync(dir)
            .filter((f) => f.endsWith(".sql"))
            .sort();
    }

    if (files.length === 0) {
        console.log("ℹ️ No seeds found.");
        await client.end();
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
    console.log("🎉 Done!");
}

// Run when executed directly
if (process.argv[1]?.includes("run-seed")) {
    const target = process.argv[2];
    runSeeds(target).catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
