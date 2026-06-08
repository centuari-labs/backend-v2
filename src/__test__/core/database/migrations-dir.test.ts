import { join, sep } from "node:path";
import {
    getMigrationsDir,
    getSeedsDir,
} from "../../../core/database/scripts/migrations-dir";

/**
 * Guards the dist-layout contract that boot-time migrations/seeds depend on.
 *
 * The build keeps the `src/` segment (compiled JS at
 * dist/src/core/database/scripts) and Nest's asset copy is pinned to the same
 * root (assets[].outDir = "dist/src" in nest-cli.json), so the .sql files must
 * resolve to dist/src/core/database/{migrations,seeds}. If the resolver math or
 * the asset outDir drift apart, the dev server / Docker image crashes at boot
 * with ENOENT on scandir — this test catches that before it ships.
 */
describe("migrations-dir resolver", () => {
    const compiledScripts = join(
        sep,
        "app",
        "dist",
        "src",
        "core",
        "database",
        "scripts",
    );
    const sourceScripts = join(
        sep,
        "repo",
        "src",
        "core",
        "database",
        "scripts",
    );

    describe("getMigrationsDir", () => {
        it("resolves to dist/src/core/database/migrations when compiled", () => {
            expect(getMigrationsDir(compiledScripts)).toBe(
                join(
                    sep,
                    "app",
                    "dist",
                    "src",
                    "core",
                    "database",
                    "migrations",
                ),
            );
        });

        it("resolves alongside the source scripts when run via ts-node", () => {
            expect(getMigrationsDir(sourceScripts)).toBe(
                join(sep, "repo", "src", "core", "database", "migrations"),
            );
        });
    });

    describe("getSeedsDir", () => {
        it("resolves to dist/src/core/database/seeds when compiled", () => {
            expect(getSeedsDir(compiledScripts)).toBe(
                join(sep, "app", "dist", "src", "core", "database", "seeds"),
            );
        });

        it("resolves alongside the source scripts when run via ts-node", () => {
            expect(getSeedsDir(sourceScripts)).toBe(
                join(sep, "repo", "src", "core", "database", "seeds"),
            );
        });
    });
});
