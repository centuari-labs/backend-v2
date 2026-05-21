/**
 * Minimal portfolio.service tests for the A5 migration. The service is now
 * thin — every read path delegates to a method on `PortfolioRepository`
 * that queries the shared on-chain-state schema (joined with local
 * `tokens` + `risk`). Tests mock the repository and assert the service
 * correctly translates rows into DTOs, applies prices, and paginates.
 *
 * The old 1300-line suite coupled to the legacy schema was removed in A5.
 * Expand coverage as follow-up work.
 */

import { Test, type TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ChainConfigService } from "../../core/chain-config/chain-config.service";
import { DatabaseService } from "../../core/database/database.service";
import { ViemService } from "../../core/viem/viem.service";
import { MarketRepositories } from "../../market/repository/market.repository";
import { MatchRepository } from "../../orders/repositories/match.repository";
import { OrderRepository } from "../../orders/repositories/order.repository";
import { PortfolioService } from "../../portfolio/portfolio.service";
import { PortfolioRepository } from "../../portfolio/repositories/portfolio.repository";
import { PriceService } from "../../price/price.service";
import { Token } from "../../tokens/entities/token.entity";
import { TokensService } from "../../tokens/tokens.service";

const USDC_UUID = "token-uuid-usdc";
const MARKET_HEX =
    "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";
const MARKET_UUID = "cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd";

describe("PortfolioService (A5)", () => {
    const wallet = "0x1111111111111111111111111111111111111111";

    let service: PortfolioService;
    let portfolioRepository: jest.Mocked<PortfolioRepository>;
    let matchRepository: jest.Mocked<MatchRepository>;
    let priceService: jest.Mocked<PriceService>;

    beforeEach(async () => {
        portfolioRepository = {
            getUserBalances: jest.fn().mockResolvedValue([]),
            getUserSuppliedAssets: jest.fn().mockResolvedValue([]),
            getUserBorrowedAssets: jest.fn().mockResolvedValue([]),
            getUserLendPositionsForApr: jest.fn().mockResolvedValue([]),
            getUserCollateralAssets: jest.fn().mockResolvedValue([]),
            getUserAssets: jest.fn().mockResolvedValue({ data: [], total: 0 }),
            getUserPositions: jest
                .fn()
                .mockResolvedValue({ data: [], total: 0 }),
            getRiskParamsByCollateralTokenIds: jest.fn().mockResolvedValue([]),
            getBorrowBufferBps: jest.fn().mockResolvedValue(null),
            getLendPosition: jest.fn().mockResolvedValue(null),
            getBorrowPosition: jest.fn().mockResolvedValue(null),
            getOrderHistory: jest
                .fn()
                .mockResolvedValue({ data: [], total: 0 }),
            getOpenOrders: jest.fn().mockResolvedValue({ data: [], total: 0 }),
        } as unknown as jest.Mocked<PortfolioRepository>;

        matchRepository = {
            getPendingBorrowMatches: jest.fn().mockResolvedValue([]),
        } as unknown as jest.Mocked<MatchRepository>;

        priceService = {
            getPrices: jest.fn().mockReturnValue({ [USDC_UUID]: 1 }),
        } as unknown as jest.Mocked<PriceService>;

        const tokensService = {
            findByTokenAddress: jest.fn().mockResolvedValue(null),
            getTokenDecimalsByAssetId: jest.fn().mockResolvedValue(6),
            getTokenByAssetId: jest.fn(),
        } as unknown as jest.Mocked<TokensService>;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PortfolioService,
                {
                    provide: getRepositoryToken(Token),
                    useValue: { find: jest.fn().mockResolvedValue([]) },
                },
                { provide: PriceService, useValue: priceService },
                { provide: TokensService, useValue: tokensService },
                {
                    provide: PortfolioRepository,
                    useValue: portfolioRepository,
                },
                {
                    provide: OrderRepository,
                    useValue: {
                        findAccountByWallet: jest
                            .fn()
                            .mockResolvedValue({ id: "acc-uuid" }),
                        findWalletByAccountId: jest
                            .fn()
                            .mockResolvedValue(wallet),
                        getOpenBorrowOrders: jest.fn().mockResolvedValue([]),
                    },
                },
                { provide: MatchRepository, useValue: matchRepository },
                { provide: MarketRepositories, useValue: {} },
                { provide: ViemService, useValue: {} },
                {
                    provide: ChainConfigService,
                    useValue: { chainId: 421614 },
                },
                { provide: DatabaseService, useValue: { getPool: jest.fn() } },
            ],
        }).compile();

        service = module.get<PortfolioService>(PortfolioService);
    });

    describe("getMyPortfolio", () => {
        it("returns zero totals when the wallet has no shared-schema state", async () => {
            const result = await service.getMyPortfolio(wallet);
            expect(result.totalDeposit).toBe(0);
            expect(result.allTimeReturn).toBe(0);
            expect(result.netAPY).toBe(0);
            expect(result.allocation.availableBalanceUsd).toBe(0);
        });

        it("aggregates balances, supplied, and borrowed USD from repository rows", async () => {
            portfolioRepository.getUserBalances.mockResolvedValue([
                {
                    asset_id: USDC_UUID,
                    symbol: "USDC",
                    name: "USD Coin",
                    image_url: null,
                    decimals: 6,
                    amount: "500000000", // 500 USDC
                    is_collateral: false,
                },
            ]);
            portfolioRepository.getUserSuppliedAssets.mockResolvedValue([
                { asset_id: USDC_UUID, amount: "100000000", decimals: 6 },
            ]);
            portfolioRepository.getUserBorrowedAssets.mockResolvedValue([
                { asset_id: USDC_UUID, amount: "210000000", decimals: 6 },
            ]);
            portfolioRepository.getUserLendPositionsForApr.mockResolvedValue([
                {
                    asset_id: USDC_UUID,
                    amount: "100000000",
                    apr: "500",
                    decimals: 6,
                },
            ]);

            const result = await service.getMyPortfolio(wallet);

            expect(result.totalDeposit).toBe(500);
            expect(result.allocation.suppliedAssetsUsd).toBe(100);
            expect(result.allocation.borrowedAssetsUsd).toBe(210);
            expect(result.allocation.availableBalanceUsd).toBe(400);
            expect(result.netAPY).toBe(5); // 500 bps = 5%
        });
    });

    describe("getMyAssets", () => {
        it("returns zero rows when the wallet has no balances", async () => {
            const result = await service.getMyAssets(wallet, {
                page: 1,
                limit: 10,
            });
            expect(result.data).toEqual([]);
            expect(result.totalData).toBe(0);
        });

        it("maps repository rows to MyAssetItemDto", async () => {
            portfolioRepository.getUserAssets.mockResolvedValue({
                total: 1,
                data: [
                    {
                        asset_id: USDC_UUID,
                        token_address:
                            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        symbol: "USDC",
                        name: "USD Coin",
                        image_url: null,
                        decimals: 6,
                        amount: "1000000",
                        is_collateral: true,
                        pending_collateral_flag: false,
                        flagged_at: "1700000000",
                    },
                ],
            });

            const result = await service.getMyAssets(wallet, {
                page: 1,
                limit: 10,
            });
            expect(result.data).toHaveLength(1);
            expect(result.data[0].walletBalance).toBe(1);
            expect(result.data[0].isCollateral).toBe(true);
            expect(result.data[0].tokenAddress).toBe(
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            );
            expect(result.data[0].pendingCollateralFlag).toBe(false);
            expect(result.data[0].flaggedAt).toBe(1700000000);
            expect(result.data[0].unlocksAt).toBe(1700000000 + 86400);
        });

        it("derives unlocksAt=0 when row is not on-chain flagged", async () => {
            portfolioRepository.getUserAssets.mockResolvedValue({
                total: 1,
                data: [
                    {
                        asset_id: USDC_UUID,
                        token_address:
                            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                        symbol: "USDC",
                        name: "USD Coin",
                        image_url: null,
                        decimals: 6,
                        amount: "1000000",
                        is_collateral: false,
                        pending_collateral_flag: true,
                        flagged_at: "0",
                    },
                ],
            });

            const result = await service.getMyAssets(wallet, {
                page: 1,
                limit: 10,
            });
            expect(result.data[0].pendingCollateralFlag).toBe(true);
            expect(result.data[0].isCollateral).toBe(false);
            expect(result.data[0].flaggedAt).toBe(0);
            expect(result.data[0].unlocksAt).toBe(0);
        });

        it("surfaces both pending and on-chain state when the user re-flags a dequeued asset", async () => {
            portfolioRepository.getUserAssets.mockResolvedValue({
                total: 1,
                data: [
                    {
                        asset_id: USDC_UUID,
                        token_address:
                            "0xcccccccccccccccccccccccccccccccccccccccc",
                        symbol: "USDC",
                        name: "USD Coin",
                        image_url: null,
                        decimals: 6,
                        amount: "1000000",
                        is_collateral: true,
                        pending_collateral_flag: true,
                        flagged_at: "1700000000",
                    },
                ],
            });

            const result = await service.getMyAssets(wallet, {
                page: 1,
                limit: 10,
            });
            expect(result.data[0].isCollateral).toBe(true);
            expect(result.data[0].pendingCollateralFlag).toBe(true);
            expect(result.data[0].unlocksAt).toBe(1700000000 + 86400);
        });
    });

    describe("getMyPosition", () => {
        it("maps unified lend/borrow rows with marketId translated to UUID", async () => {
            portfolioRepository.getUserPositions.mockResolvedValue({
                total: 1,
                data: [
                    {
                        position_id: MARKET_HEX,
                        market_id: MARKET_HEX,
                        asset_id: USDC_UUID,
                        side: "LEND" as never,
                        rate: "500",
                        quantity: "1000000",
                        base_amount: "1000000",
                        status: "OPEN" as never,
                        symbol: "USDC",
                        name: "USD Coin",
                        token_address:
                            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        image_url: null,
                        decimals: 6,
                        maturity: new Date(2000000000 * 1000),
                        created_at: new Date(),
                    },
                ],
            });

            const result = await service.getMyPosition(wallet, {
                page: 1,
                limit: 10,
            });
            expect(result.totalData).toBe(1);
            expect(result.data[0].marketId).toBe(MARKET_UUID);
            expect(result.data[0].side).toBe("LEND");
            expect(result.data[0].shares).toBe(1);
        });
    });

    describe("getHealthFactorForAccount with includeOpenOrders", () => {
        const accountId = "acc-uuid";

        it("rolls FILLED-but-unsettled borrow matches into the prospective debt", async () => {
            // 1000 USDC collateral at $1, 75% LTV; no settled debt; one
            // pending match for 500 USDC. Without the pending match the HF
            // would be Infinity (no debt); with it folded in we expect
            // ((1000 - 0) * 0.75) / 500 = 1.5.
            portfolioRepository.getUserCollateralAssets.mockResolvedValue([
                { asset_id: USDC_UUID, amount: "1000000000", decimals: 6 },
            ]);
            portfolioRepository.getRiskParamsByCollateralTokenIds.mockResolvedValue(
                [
                    {
                        asset_id: USDC_UUID,
                        avg_ltv: "7500",
                        avg_lt: "8000",
                    },
                ],
            );
            matchRepository.getPendingBorrowMatches.mockResolvedValue([
                { assetId: USDC_UUID, matchAmount: "500000000" },
            ]);

            const result = await service.getHealthFactorForAccount(accountId, {
                includeOpenOrders: true,
            });

            expect(
                matchRepository.getPendingBorrowMatches,
            ).toHaveBeenCalledWith(accountId);
            expect(result.debtUsd).toBeCloseTo(500, 5);
            expect(result.healthFactor).toBeCloseTo(1.5, 5);
        });

        it("ignores pending matches when includeOpenOrders is false", async () => {
            portfolioRepository.getUserCollateralAssets.mockResolvedValue([
                { asset_id: USDC_UUID, amount: "1000000000", decimals: 6 },
            ]);
            matchRepository.getPendingBorrowMatches.mockResolvedValue([
                { assetId: USDC_UUID, matchAmount: "500000000" },
            ]);

            const result = await service.getHealthFactorForAccount(accountId);

            expect(
                matchRepository.getPendingBorrowMatches,
            ).not.toHaveBeenCalled();
            expect(result.debtUsd).toBe(0);
        });
    });

    describe("getBorrowBufferBps", () => {
        const accountId = "acc-uuid";
        const LOAN_TOKEN_UUID = "token-uuid-loan";

        it("returns DEFAULT_BORROW_BUFFER_BPS when user has no flagged collateral", async () => {
            portfolioRepository.getUserCollateralAssets.mockResolvedValue([]);

            const buffer = await service.getBorrowBufferBps(
                accountId,
                LOAN_TOKEN_UUID,
            );

            expect(buffer).toBe(100);
            expect(
                portfolioRepository.getBorrowBufferBps,
            ).not.toHaveBeenCalled();
        });

        it("returns DEFAULT when no risk row matches the user's collateral × loan token", async () => {
            portfolioRepository.getUserCollateralAssets.mockResolvedValue([
                { asset_id: USDC_UUID, amount: "1000", decimals: 6 },
            ]);
            (
                portfolioRepository.getBorrowBufferBps as jest.Mock
            ).mockResolvedValue(null);

            const buffer = await service.getBorrowBufferBps(
                accountId,
                LOAN_TOKEN_UUID,
            );

            expect(buffer).toBe(100);
        });

        it("returns repo result when a risk row matches", async () => {
            portfolioRepository.getUserCollateralAssets.mockResolvedValue([
                { asset_id: USDC_UUID, amount: "1000", decimals: 6 },
            ]);
            (
                portfolioRepository.getBorrowBufferBps as jest.Mock
            ).mockResolvedValue(500);

            const buffer = await service.getBorrowBufferBps(
                accountId,
                LOAN_TOKEN_UUID,
            );

            expect(buffer).toBe(500);
            expect(portfolioRepository.getBorrowBufferBps).toHaveBeenCalledWith(
                [USDC_UUID],
                LOAN_TOKEN_UUID,
            );
        });
    });

    describe("order maturity conversion", () => {
        // Post-C4, maturity comes from the new `market` table as a BIGINT epoch
        // (seconds), not the old `markets` timestamp. The service must convert
        // seconds -> ms before building the ISO string.
        const baseRow = {
            id: "order-uuid",
            side: "LEND",
            order_type: "LIMIT",
            rate: "500",
            amount: "1000000",
            filled_quantity: null,
            status: "OPEN",
            cancel_reason: null,
            asset_id: USDC_UUID,
            name: "USD Coin",
            symbol: "USDC",
            image_url: null,
            decimals: "6",
            token_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            created_at: "2025-01-01T00:00:00.000Z",
        };

        it("getOrderHistory maps epoch-seconds maturity to an ISO string", async () => {
            portfolioRepository.getOrderHistory.mockResolvedValue({
                total: 1,
                data: [{ ...baseRow, maturity: "1735689600", total_fee: "0" }],
            });

            const result = await service.getOrderHistory(wallet, {
                page: 1,
                limit: 10,
            });

            expect(result.data[0].maturity).toBe("2025-01-01T00:00:00.000Z");
        });

        it("getOpenOrders maps epoch-seconds maturity to an ISO string", async () => {
            portfolioRepository.getOpenOrders.mockResolvedValue({
                total: 1,
                data: [{ ...baseRow, maturity: "1735689600" }],
            });

            const result = await service.getOpenOrders(wallet, {
                page: 1,
                limit: 10,
            });

            expect(result.data[0].maturity).toBe("2025-01-01T00:00:00.000Z");
        });

        it("leaves maturity null when the order has no market row", async () => {
            portfolioRepository.getOpenOrders.mockResolvedValue({
                total: 1,
                data: [{ ...baseRow, maturity: null }],
            });

            const result = await service.getOpenOrders(wallet, {
                page: 1,
                limit: 10,
            });

            expect(result.data[0].maturity).toBeNull();
        });
    });
});
