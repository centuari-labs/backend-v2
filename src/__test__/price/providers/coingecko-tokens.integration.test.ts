import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { TokensModule } from "../../../tokens/tokens.module";
import { TokensRepository } from "../../../tokens/repositories/tokens.repository";
import { CoinGeckoProvider } from "../../../price/providers/coingecko.provider";

/**
 * Integration test: fetches all tokens from DB and verifies CoinGecko can return prices for each.
 * Requires: DATABASE_URL set, DB seeded, network access.
 * Run: pnpm test:integration:price
 */
describe("CoinGeckoProvider with DB tokens (integration)", () => {
    let module: TestingModule;
    let tokensRepository: TokensRepository;
    let provider: CoinGeckoProvider;

    beforeAll(async () => {
        module = await Test.createTestingModule({
            imports: [
                //@todo : fix error connecting to database
                TypeOrmModule.forRoot({
                    type: "postgres",
                    url: process.env.DATABASE_URL,
                    autoLoadEntities: true,
                    synchronize: false,
                    logging: false,
                }),
                TokensModule,
            ],
            providers: [CoinGeckoProvider],
        }).compile();

        tokensRepository = module.get(TokensRepository);
        provider = module.get(CoinGeckoProvider);
    });

    afterAll(async () => {
        const dataSource = module.get(DataSource);
        await dataSource.destroy();
    });

    it(
        "should fetch prices for all tokens with coingeckoId in DB",
        async () => {
            const tokens = await tokensRepository.getActiveTokens();
            const tokensWithCoingecko = tokens.filter((t) => t.coingeckoId);

            expect(
                tokensWithCoingecko.length,
            ).toBeGreaterThan(0);

            const prices = await provider.fetchPrices(tokens);

            const missing: string[] = [];
            for (const token of tokensWithCoingecko) {
                const price = prices[token.symbol];
                if (typeof price !== "number" || price <= 0) {
                    missing.push(`${token.symbol} (${token.coingeckoId})`);
                }
            }

            expect(missing).toEqual([]);
        },
        15_000,
    );
});
