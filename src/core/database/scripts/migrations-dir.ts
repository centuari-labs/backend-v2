import { join, sep } from "node:path";

/**
 * Resolve the migrations directory so it works both when running from source
 * (ts-node) and when running from compiled output (e.g. Docker).
 *
 * The build keeps the `src/` segment in the output tree (compiled JS lands at
 * dist/src/core/database/scripts) because the root-level `scripts/` dir is also
 * compiled, dragging tsc's common rootDir up to the project root. Nest's asset
 * copy is pinned to the same root via `assets[].outDir = "dist/src"` in
 * nest-cli.json, so the .sql files land at dist/src/core/database/migrations —
 * three levels up from the compiled scripts dir, matching the source layout.
 */
export function getMigrationsDir(callerDirname: string): string {
    const isCompiled = callerDirname.includes(`${sep}dist${sep}`);
    return isCompiled
        ? join(
              callerDirname,
              "..",
              "..",
              "..",
              "core",
              "database",
              "migrations",
          )
        : join(callerDirname, "..", "migrations");
}

/** Same as getMigrationsDir but for the seeds directory. */
export function getSeedsDir(callerDirname: string): string {
    const isCompiled = callerDirname.includes(`${sep}dist${sep}`);
    return isCompiled
        ? join(callerDirname, "..", "..", "..", "core", "database", "seeds")
        : join(callerDirname, "..", "seeds");
}
