import { PriceService } from "../../price/price.service";
import { Repository } from "typeorm";
import { Token } from "../../tokens/entities/token.entity";

/**
 * Optimized helper to fetch prices for a list of assets.
 * Reduces N+1 queries by potentially batching or just centralizing logic.
 */
export async function getPriceMap(
    assets: Token[],
    priceService: PriceService
): Promise<Map<string, number>> {
    const priceMap = new Map<string, number>();

    await Promise.all(
        assets.map(async (asset) => {
            const price = await priceService.getPrice(asset.tokenAddress);
            if (price !== null) {
                priceMap.set(asset.id, price);
            }
        })
    );

    return priceMap;
}

export async function buildPriceMapForAssets(
    assetIds: string[],
    priceService: PriceService,
    tokenRepository: Repository<Token>
): Promise<Map<string, number>> {
    if (!assetIds.length) {
        return new Map();
    }

    // Fetch only necessary fields (id, tokenAddress) to minimize data transfer
    const tokens = await tokenRepository
        .createQueryBuilder("token")
        .select(["token.id", "token.tokenAddress"])
        .where("token.id IN (:...assetIds)", { assetIds })
        .getMany();

    return getPriceMap(tokens, priceService);
}
