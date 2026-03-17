import { keccak256, encodeAbiParameters, type Address } from "viem";

/**
 * Compute a deterministic market UUID that matches the on-chain marketId.
 *
 * On-chain: `marketId = keccak256(abi.encode(loanToken, maturity))`
 * Off-chain: take first 32 hex chars of the bytes32 → format as UUID.
 *
 * @param loanTokenAddress - ERC-20 loan token contract address.
 * @param maturityUnixSeconds - Maturity as Unix timestamp in seconds.
 * @returns UUID string matching the on-chain derived marketId.
 */
export function computeMarketId(
    loanTokenAddress: string,
    maturityUnixSeconds: number,
): string {
    const encoded = encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [loanTokenAddress as Address, BigInt(maturityUnixSeconds)],
    );
    const hash = keccak256(encoded); // 0x + 64 hex chars
    const hex = hash.slice(2, 34); // first 32 hex chars (16 bytes)
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
