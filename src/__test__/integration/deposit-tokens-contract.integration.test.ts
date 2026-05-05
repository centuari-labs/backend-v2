/**
 * Integration test: contract guard for GET /deposit/tokens.
 *
 * Why this test exists
 * --------------------
 * The frontend branch `feat/token-metadata-localstorage-cache` removed
 * its hardcoded TOKENS / MARKET_TOKEN_LIST constants and made the
 * backend the single source of truth for the token catalog. From now
 * on, any silent regression in this endpoint's shape, ordering, or
 * seed coverage breaks the frontend.
 *
 * This file guards three contracts:
 *   1. Shape — every token matches the FE-side DepositToken schema.
 *   2. Determinism — two consecutive requests return identical bodies.
 *   3. Priority ordering — DEPOSIT_TOKEN_PRIORITY symbols come first
 *      and in declared order, with non-priority symbols alphabetised
 *      after them (mirrors `compareTokensByPriority`).
 */

jest.mock("../../core/privy/privy.service", () => ({}));
jest.mock("../../common/guards/strategies/privy-auth.strategy", () => ({
    PrivyAuthStrategy: class MockPrivyAuthStrategy {
        async validate() {
            return { userId: "mock", walletAddress: "0xMock" };
        }
        getName() {
            return "privy";
        }
    },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import request from "supertest";
import type { App } from "supertest/types";
import { z } from "zod";

import { DepositController } from "src/deposit/deposit.controller";
import { DepositService } from "src/deposit/deposit.service";
import { TokensRepository } from "src/tokens/repositories/tokens.repository";
import { TokensService } from "src/tokens/tokens.service";
import { ViemService } from "src/core/viem/viem.service";
import { ChainIndexerService } from "src/chain-indexer/chain-indexer.service";
import { ChainConfigService } from "src/core/chain-config/chain-config.service";
import { ResponseInterceptor } from "src/common/interceptors/response.interceptor";
import { AuthGuard } from "src/common/guards/auth.guard";
import { AuthStrategyFactory } from "src/common/guards/strategies/auth-strategy.factory";
import { PrivyAuthStrategy } from "src/common/guards/strategies/privy-auth.strategy";
import { DEPOSIT_TOKEN_PRIORITY } from "src/tokens/token-order.config";

/** FE-side contract for a token entry (mirror of DepositToken in lib/api.ts). */
const DepositTokenSchema = z.object({
    id: z.string().uuid(),
    symbol: z.string().min(1),
    name: z.string().min(1),
    tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    decimals: z.number().int().nullable(),
    imageUrl: z.string().nullable(),
    chainId: z.number().nullable(),
});

interface SeedSpec {
    symbol: string;
    name: string;
    id: string;
    tokenAddress: string;
}

function makeToken(spec: SeedSpec) {
    return {
        id: spec.id,
        tokenAddress: spec.tokenAddress,
        symbol: spec.symbol,
        name: spec.name,
        isLoanToken: true,
        chainId: 421614,
        imageUrl: `/tokens/${spec.symbol.toLowerCase()}-icon.webp`,
        averageLTV: null,
        coingeckoId: spec.symbol.toLowerCase(),
        decimals: 6,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    };
}

/**
 * Realistic seed: priority tokens + a few RWA / non-priority tokens in
 * unsorted order, so the priority-sort assertion is meaningful.
 */
const seed = [
    makeToken({
        symbol: "AAPLon",
        name: "Apple (Ondo)",
        id: "11111111-1111-1111-1111-111111111101",
        tokenAddress: "0xf554E2813B5959B6896aDc650231b76d716F3812",
    }),
    makeToken({
        symbol: "USDT",
        name: "Tether USD",
        id: "11111111-1111-1111-1111-111111111102",
        tokenAddress: "0xe1e9f8aDFBee861d1173850d692dD3863B7f2b61",
    }),
    makeToken({
        symbol: "BTC",
        name: "Bitcoin",
        id: "11111111-1111-1111-1111-111111111103",
        tokenAddress: "0xc2EFd38075d80e0bEfa7F4343c1102344B9aD44c",
    }),
    makeToken({
        symbol: "USDC",
        name: "USD Coin",
        id: "11111111-1111-1111-1111-111111111104",
        tokenAddress: "0x26970F990252306AFa328B2c91225605c0862498",
    }),
    makeToken({
        symbol: "XSGD",
        name: "StraitsX SGD",
        id: "11111111-1111-1111-1111-111111111105",
        tokenAddress: "0x612CFED4026384AF12c573A64F4d2996620D911e",
    }),
    makeToken({
        symbol: "IDRX",
        name: "Indonesian Rupiah",
        id: "11111111-1111-1111-1111-111111111106",
        tokenAddress: "0xDB0683a2A3d85B07f35F7eD4413E88C28Da26C7C",
    }),
    makeToken({
        symbol: "ETH",
        name: "Ethereum",
        id: "11111111-1111-1111-1111-111111111107",
        tokenAddress: "0x80E70a7949f9657729d09e144f65812b90E16Cb4",
    }),
];

describe("Deposit Tokens Contract (Integration)", () => {
    let app: INestApplication<App>;

    beforeEach(async () => {
        const mockTokensRepository: Partial<jest.Mocked<TokensRepository>> = {
            findDepositTokens: jest.fn().mockResolvedValue(seed),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [DepositController],
            providers: [
                DepositService,
                { provide: TokensRepository, useValue: mockTokensRepository },
                {
                    provide: TokensService,
                    useValue: { getTokenByAssetId: jest.fn() },
                },
                {
                    provide: ViemService,
                    useValue: { readContract: jest.fn() },
                },
                {
                    provide: ConfigService,
                    useValue: { get: jest.fn().mockReturnValue("test") },
                },
                {
                    provide: ChainIndexerService,
                    useValue: { processTransactionDeposits: jest.fn() },
                },
                {
                    provide: ChainConfigService,
                    useValue: {
                        chainId: 421614,
                        operatorPrivateKey: "",
                        treasuryAddress: "",
                        centuariAddress: "",
                    },
                },
                AuthGuard,
                AuthStrategyFactory,
                PrivyAuthStrategy,
            ],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalInterceptors(new ResponseInterceptor());
        await app.init();
    });

    afterEach(async () => {
        await app.close();
        jest.clearAllMocks();
    });

    describe("shape contract", () => {
        it("every returned token matches the DepositToken schema", async () => {
            const res = await request(app.getHttpServer())
                .get("/deposit/tokens")
                .expect(HttpStatus.OK);

            expect(Array.isArray(res.body.data)).toBe(true);
            for (const token of res.body.data) {
                expect(() => DepositTokenSchema.parse(token)).not.toThrow();
            }
        });

        it("envelope shape is { statusCode, data } with no extra top-level fields", async () => {
            const res = await request(app.getHttpServer())
                .get("/deposit/tokens")
                .expect(HttpStatus.OK);

            expect(Object.keys(res.body).sort()).toEqual([
                "data",
                "statusCode",
            ]);
            expect(res.body.statusCode).toBe(200);
        });
    });

    describe("determinism", () => {
        it("two consecutive requests return identical bodies", async () => {
            const a = await request(app.getHttpServer())
                .get("/deposit/tokens")
                .expect(HttpStatus.OK);
            const b = await request(app.getHttpServer())
                .get("/deposit/tokens")
                .expect(HttpStatus.OK);

            expect(b.body).toEqual(a.body);
        });
    });

    describe("priority ordering", () => {
        it("DEPOSIT_TOKEN_PRIORITY symbols appear first and in declared order", async () => {
            const res = await request(app.getHttpServer())
                .get("/deposit/tokens")
                .expect(HttpStatus.OK);

            const returnedSymbols: string[] = res.body.data.map(
                (t: { symbol: string }) => t.symbol,
            );

            const prioritySymbolsInResponse = returnedSymbols.filter(
                (s): s is (typeof DEPOSIT_TOKEN_PRIORITY)[number] =>
                    (DEPOSIT_TOKEN_PRIORITY as readonly string[]).includes(s),
            );

            // Priority-listed tokens must appear in the exact order declared.
            expect(prioritySymbolsInResponse).toEqual(
                DEPOSIT_TOKEN_PRIORITY.filter((s) =>
                    returnedSymbols.includes(s),
                ),
            );

            // Priority symbols must come strictly before any non-priority symbol.
            const lastPriorityIdx = Math.max(
                ...prioritySymbolsInResponse.map((s) =>
                    returnedSymbols.indexOf(s),
                ),
            );
            const firstNonPriorityIdx = returnedSymbols.findIndex(
                (s) =>
                    !(DEPOSIT_TOKEN_PRIORITY as readonly string[]).includes(s),
            );
            if (firstNonPriorityIdx !== -1) {
                expect(firstNonPriorityIdx).toBeGreaterThan(lastPriorityIdx);
            }
        });

        it("non-priority symbols are sorted alphabetically after priority ones", async () => {
            const res = await request(app.getHttpServer())
                .get("/deposit/tokens")
                .expect(HttpStatus.OK);

            const returnedSymbols: string[] = res.body.data.map(
                (t: { symbol: string }) => t.symbol,
            );
            const nonPriority = returnedSymbols.filter(
                (s) =>
                    !(DEPOSIT_TOKEN_PRIORITY as readonly string[]).includes(s),
            );
            const sorted = [...nonPriority].sort((a, b) => a.localeCompare(b));
            expect(nonPriority).toEqual(sorted);
        });
    });
});
