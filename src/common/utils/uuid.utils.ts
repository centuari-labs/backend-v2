import * as crypto from "crypto";

/**
 * Converts a UUID to a bytes32 hex string by stripping dashes and zero-padding.
 * Matches the settlement engine's `uuidToBytes32Direct` encoding so the
 * on-chain marketId round-trips back to the original backend UUID.
 */
export function uuidToBytes32(uuid: string): `0x${string}` {
    const hex = uuid.replace(/-/g, "");
    return `0x${hex.padEnd(64, "0")}` as `0x${string}`;
}

/**
 * Generates a deterministic UUID for a portfolio row from user wallet and token address.
 * Matches the indexer's portfolioUuidFor logic so backend and indexer produce the same IDs.
 */
export function portfolioUuidFor(
    walletLower: string,
    tokenAddressLower: string,
): string {
    const base = `${walletLower}-${tokenAddressLower}`;
    const hash = crypto
        .createHash("sha1")
        .update(base)
        .digest("hex")
        .slice(0, 32);
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}
