
export function calculateUsdAmount(
    amount: string | number,
    price: number | undefined
): string {
    if (price === undefined) {
        return '0.00';
    }
    const numAmount = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
    return (numAmount * price).toFixed(2);
}

export function createPaginatedResponse<T>(
    data: T[],
    total: number,
    page: number,
    limit: number
): {
    data: T[];
    page: number;
    limit: number;
    totalData: number;
    totalPages: number;
} {
    return {
        data,
        page,
        limit,
        totalData: total,
        totalPages: Math.ceil(total / limit),
    };
}

