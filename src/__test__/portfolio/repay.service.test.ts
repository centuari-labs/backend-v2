/**
 * Minimal repay.service tests for the A5 migration. The service now
 * reads debt from the shared `borrow_position` via
 * `PortfolioRepository.getBorrowPosition`, submits the on-chain tx, and
 * delegates persistence to `applyRepayEffects`.
 */

import { Test, type TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { TransactionReceipt } from "viem";
import { ChainConfigService } from "../../core/chain-config/chain-config.service";
import { DatabaseService } from "../../core/database/database.service";
import { ViemService } from "../../core/viem/viem.service";
import { RepayService } from "../../portfolio/repay.service";
import { PortfolioRepository } from "../../portfolio/repositories/portfolio.repository";
import { MarketRepositories } from "../../market/repository/market.repository";

jest.mock("../../core/on-chain-state/apply-repay", () => ({
    applyRepayEffects: jest.fn().mockResolvedValue(undefined),
}));
import { applyRepayEffects } from "../../core/on-chain-state/apply-repay";

const MARKET_ID = "0x" + "cd".repeat(32);
const WALLET = "0x1111111111111111111111111111111111111111";

describe("RepayService (A5)", () => {
    let service: RepayService;
    let marketRepository: jest.Mocked<MarketRepositories>;
    let portfolioRepository: jest.Mocked<PortfolioRepository>;
    let viemService: jest.Mocked<ViemService>;

    beforeEach(async () => {
        (applyRepayEffects as jest.Mock).mockClear();

        marketRepository = {
            getMarketWithAsset: jest.fn().mockResolvedValue({
                id: MARKET_ID,
                assetId: "asset-uuid",
                maturity: new Date().toISOString(),
                tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                decimals: 6,
            }),
        } as unknown as jest.Mocked<MarketRepositories>;

        portfolioRepository = {
            getBorrowPosition: jest.fn().mockResolvedValue(null),
        } as unknown as jest.Mocked<PortfolioRepository>;

        const receipt = {
            transactionHash: "0x" + "ab".repeat(32),
            blockHash: "0x" + "cd".repeat(32),
            blockNumber: 1n,
            status: "success",
            logs: [],
        } as unknown as TransactionReceipt;
        viemService = {
            writeContract: jest.fn().mockResolvedValue(receipt),
            getPublicClient: jest.fn().mockReturnValue({}),
        } as unknown as jest.Mocked<ViemService>;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RepayService,
                { provide: ViemService, useValue: viemService },
                { provide: MarketRepositories, useValue: marketRepository },
                {
                    provide: PortfolioRepository,
                    useValue: portfolioRepository,
                },
                {
                    provide: ChainConfigService,
                    useValue: {
                        chainId: 421614,
                        operatorPrivateKey: "",
                        centuariAddress:
                            "0xcccccccccccccccccccccccccccccccccccccccc",
                    },
                },
                {
                    provide: DatabaseService,
                    useValue: { getPool: jest.fn().mockReturnValue({}) },
                },
            ],
        }).compile();

        service = module.get<RepayService>(RepayService);
    });

    it("throws NotFound when the market is unknown", async () => {
        marketRepository.getMarketWithAsset.mockResolvedValue(null as never);
        await expect(
            service.repay(
                { marketId: MARKET_ID, amount: "1" },
                WALLET,
                "privy-user",
            ),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws NotFound when the borrower has no debt on the shared schema", async () => {
        portfolioRepository.getBorrowPosition.mockResolvedValue(null);
        await expect(
            service.repay(
                { marketId: MARKET_ID, amount: "1" },
                WALLET,
                "privy-user",
            ),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects repay amounts exceeding total debt", async () => {
        portfolioRepository.getBorrowPosition.mockResolvedValue({
            principal: "1000000",
            debt: "1000000",
        });
        await expect(
            service.repay(
                { marketId: MARKET_ID, amount: "10" },
                WALLET,
                "privy-user",
            ),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("writes the on-chain tx and delegates persistence to applyRepayEffects", async () => {
        portfolioRepository.getBorrowPosition.mockResolvedValue({
            principal: "1000000",
            debt: "1000000",
        });

        const result = await service.repay(
            { marketId: MARKET_ID, amount: "0.5" },
            WALLET,
            "privy-user",
        );

        expect(viemService.writeContract).toHaveBeenCalledTimes(1);
        expect(applyRepayEffects).toHaveBeenCalledTimes(1);
        expect(result.status).toBe("success");
        expect(result.txHash).toMatch(/^0x/);
    });
});
