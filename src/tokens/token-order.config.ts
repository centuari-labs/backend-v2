export const DEPOSIT_TOKEN_PRIORITY = ["USDC", "USDT", "IDRX", "XSGD"] as const;

type PrioritySymbol = (typeof DEPOSIT_TOKEN_PRIORITY)[number];

function getPriorityIndex(symbol: string): number {
    const idx = DEPOSIT_TOKEN_PRIORITY.indexOf(symbol as PrioritySymbol);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

export function compareTokensByPriority<
    T extends { symbol: string | null | undefined },
>(a: T, b: T): number {
    const symbolA = a.symbol ?? "";
    const symbolB = b.symbol ?? "";

    const pa = getPriorityIndex(symbolA);
    const pb = getPriorityIndex(symbolB);

    if (pa !== pb) return pa - pb;

    return symbolA.localeCompare(symbolB);
}
