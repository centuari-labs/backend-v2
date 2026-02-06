import { Injectable } from '@nestjs/common';
import { PriceProvider } from './price-provider.interface';

@Injectable()
export class InternalPriceProvider implements PriceProvider {
    async getPrices(symbols: string[]): Promise<Map<string, number | null>> {
        const priceMap = new Map<string, number | null>();

        for (const symbol of symbols) {
            priceMap.set(symbol.toUpperCase(), null);
        }

        return priceMap;
    }
}
