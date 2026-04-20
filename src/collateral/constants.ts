import { keccak256, toHex } from "viem";

/**
 * 5-param shape emitted by BalanceLedger when CollateralManager flags or
 * unflags an asset for a user. This is the only event the Phase 1 collateral
 * endpoints look for in the receipt.
 */
export const COLLATERAL_FLAG_SET_ABI = [
    {
        type: "event",
        name: "CollateralFlagSet",
        inputs: [
            { name: "writer", type: "address", indexed: true },
            { name: "user", type: "address", indexed: true },
            { name: "asset", type: "address", indexed: true },
            { name: "used", type: "bool", indexed: false },
            { name: "flaggedAt", type: "uint64", indexed: false },
        ],
    },
] as const;

export const COLLATERAL_FLAG_SET_TOPIC0 = keccak256(
    toHex("CollateralFlagSet(address,address,address,bool,uint64)"),
);

export interface CollateralFlagSetArgs {
    writer: `0x${string}`;
    user: `0x${string}`;
    asset: `0x${string}`;
    used: boolean;
    flaggedAt: bigint;
}
