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
 * Inverse of {@link uuidToBytes32}. Extracts the 32-char UUID prefix from a
 * bytes32 hex string and reformats with dashes. Assumes the bytes32 was
 * produced by `uuidToBytes32` (i.e. zero-padded on the right). On-chain
 * marketIds in Centuari-v2 are encoded this way so the indexer-v3 `market.
 * market_id` column round-trips back to the backend `markets.id` UUID.
 */
export function bytes32ToUuid(hex: string): string {
    const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (stripped.length !== 64) {
        throw new Error(`bytes32ToUuid: expected 32-byte hex, got ${hex}`);
    }
    const uuidHex = stripped.slice(0, 32);
    return (
        `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-` +
        `${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-` +
        `${uuidHex.slice(20, 32)}`
    );
}
