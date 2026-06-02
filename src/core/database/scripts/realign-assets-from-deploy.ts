import { join } from "node:path";
import "dotenv/config";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { getSeedsDir } from "./migrations-dir";

/**
 * Re-align the hardcoded `assets.token_address` values in the genesis seed
 * with the mock-token addresses from a fresh deployment.
 *
 * HubDepositor._supportedAssets is the on-chain source of truth — a stale
 * address reverts deposits with `UnsupportedAsset`. sync-to-services.sh
 * refreshes .env.contracts + frontend tokens.json but NOT the DB seed, so a
 * fresh `run-all.sh` (with new mock tokens) leaves this seed drifted. This
 * script closes that drift class deterministically: it rewrites the address
 * column per symbol from the deployment summary's `mockTokens` map.
 *
 * Usage (run BEFORE `pnpm run seed` on a fresh deploy):
 *   pnpm run db realign:assets /abs/path/deploy-arb-sepolia-latest.json
 *   DEPLOY_JSON=/abs/path/deploy-arb-sepolia-latest.json pnpm run db realign:assets
 *
 * Idempotent: re-running with the same deployment is a no-op.
 */

// Captures the assets VALUES rows: ('Name', 'SYMBOL', '0x<address>'
const ASSET_ROW = /\(\s*'[^']*',\s*'([A-Za-z0-9]+)',\s*'(0x[0-9a-fA-F]{40})'/g;

type MockTokens = Record<string, string>;

function loadMockTokens(deployJsonPath: string): MockTokens {
    const raw = readFileSync(deployJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { mockTokens?: MockTokens };
    const tokens = parsed.mockTokens;
    if (!tokens || typeof tokens !== "object" || !Object.keys(tokens).length) {
        throw new Error(
            `Deployment summary ${deployJsonPath} has no usable "mockTokens" map.`,
        );
    }
    return tokens;
}

export function realignAssetsFromDeploy(deployJsonPath?: string): void {
    const resolved = deployJsonPath ?? process.env.DEPLOY_JSON;
    if (!resolved) {
        throw new Error(
            "No deployment summary path provided. Pass it as an argument or " +
                "set DEPLOY_JSON (e.g. " +
                "smart-contract-revamp/deployments/deploy-arb-sepolia-latest.json).",
        );
    }

    const tokens = loadMockTokens(resolved);
    const dir = getSeedsDir(__dirname);
    const seedFiles = readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .filter((f) =>
            readFileSync(join(dir, f), "utf8").includes("INSERT INTO assets"),
        );

    if (seedFiles.length === 0) {
        throw new Error(`No asset seed file found in ${dir}.`);
    }

    const missing = new Set<string>();
    const changes: Array<{
        file: string;
        symbol: string;
        from: string;
        to: string;
    }> = [];

    for (const file of seedFiles) {
        const path = join(dir, file);
        const before = readFileSync(path, "utf8");

        const after = before.replace(
            ASSET_ROW,
            (full, symbol: string, oldAddr: string) => {
                const next = tokens[symbol];
                if (!next) {
                    missing.add(symbol);
                    return full;
                }
                if (next.toLowerCase() !== oldAddr.toLowerCase()) {
                    changes.push({ file, symbol, from: oldAddr, to: next });
                    return full.replace(oldAddr, next);
                }
                return full;
            },
        );

        if (after !== before) {
            writeFileSync(path, after);
        }
    }

    if (missing.size > 0) {
        throw new Error(
            `Deployment summary is missing mockTokens for seeded symbol(s): ${[
                ...missing,
            ].join(", ")}. Refusing to seed with a partial realign.`,
        );
    }

    if (changes.length === 0) {
        console.log("✅ Seed already aligned with deployment — no changes.");
        return;
    }

    console.log(`🔧 Re-aligned ${changes.length} token address(es):`);
    for (const c of changes) {
        console.log(
            `   ${c.symbol.padEnd(7)} ${c.from} → ${c.to}  (${c.file})`,
        );
    }
    console.log(
        "✅ Done. Run `pnpm run seed` to load the realigned addresses.",
    );
}

// Run when executed directly
if (process.argv[1]?.includes("realign-assets-from-deploy")) {
    try {
        realignAssetsFromDeploy(process.argv[2]);
    } catch (e) {
        console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
    }
}
