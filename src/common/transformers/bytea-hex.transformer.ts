import type { ValueTransformer } from "typeorm";

/**
 * TypeORM value transformer for `bytea` columns that should round-trip as
 * `0x`-prefixed hex strings in application code. Used by entities that
 * mirror the shared on-chain-state schema (user addresses, asset
 * addresses, market IDs, tx hashes, etc.) so the service layer never has
 * to touch `Buffer` directly.
 *
 * - `to(value)`   — called when writing to the DB or when TypeORM
 *   translates a `where` clause. Accepts `0x...` or bare hex; returns a
 *   `Buffer` for pg to bind as `bytea`.
 * - `from(value)` — called on hydration. Takes a `Buffer` and returns
 *   `0x`-prefixed lowercase hex.
 *
 * Raw-string QueryBuilder `.where("col = :p", { p })` fragments do NOT
 * auto-apply this transformer — pass `BYTEA_HEX.to(hex)` explicitly at
 * the call site in that case.
 */
export const BYTEA_HEX: ValueTransformer = {
    to(value?: string | null): Buffer | null {
        if (value == null) return null;
        const stripped =
            value.startsWith("0x") || value.startsWith("0X")
                ? value.slice(2)
                : value;
        return Buffer.from(stripped, "hex");
    },
    from(value?: Buffer | null): string | null {
        if (value == null) return null;
        return `0x${value.toString("hex")}`;
    },
};
