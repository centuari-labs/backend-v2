import { join, sep } from "node:path";

/**
 * Resolve the migrations directory so it works both when running from source
 * (ts-node) and when running from compiled output (e.g. Docker).
 * Nest copies .sql assets to dist/core/database/migrations, and with
 * sourceRoot=src in nest-cli.json compiled JS lives in
 * dist/core/database/scripts.
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
