import { encodeAbiParameters, keccak256, type Address } from "viem";

/**
 * Compute the canonical bytes32 marketId for a (loanToken, maturity) pair.
 *
 * Encoding: `uuidToBytes32(legacyUuid)` semantics — take the first 16 bytes
 * of `keccak256(abi.encode(loanToken, maturity))` and zero-pad to 32 bytes.
 * This is the calldata-verbatim value `Centuari.settleMatch` re-emits via
 * `MarketCreated` (see [Centuari.sol:81-102, 295]). The on-chain marketId
 * stored in indexer-v3's `market.market_id` is byte-identical to this.
 *
 * Do NOT change to full-width `keccak256(abi.encode(loanToken, maturity))`
 * without migrating every existing row in `market`, `order_markets`,
 * `matches`, `lend_position`, `borrow_position`, and `pending_collateral_flags`
 * — see C4 plan §Phase 2 §A.
 */
export function computeMarketIdBytes32(
    loanTokenAddress: string,
    maturityUnixSeconds: number,
): `0x${string}` {
    const encoded = encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [loanTokenAddress as Address, BigInt(maturityUnixSeconds)],
    );
    const hash = keccak256(encoded); // 0x + 64 hex chars (32 bytes)
    // First 16 bytes (32 hex chars) zero-padded to 32 bytes (64 hex chars).
    return `0x${hash.slice(2, 34)}${"0".repeat(32)}` as `0x${string}`;
}
