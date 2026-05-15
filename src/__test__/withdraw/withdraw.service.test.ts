/**
 * WithdrawService tests for the C3 Phase 2 migration. The service now
 * reads `user_balance` (no pessimistic lock), submits
 * `HubDepositor.payout`, and delegates persistence to
 * `applyWithdrawEffects`. No more LegacyPortfolio QueryRunner setup.
 */

import { Test, type TestingModule } from "@nestjs/testing";
import {
    BadRequestException,
    InternalServerErrorException,
    NotFoundException,
} from "@nestjs/common";
import type { TransactionReceipt } from "viem";
import { ChainConfigService } from "../../core/chain-config/chain-config.service";
import { DatabaseService } from "../../core/database/database.service";
import { ViemService } from "../../core/viem/viem.service";
import { WithdrawService } from "../../withdraw/withdraw.service";
import { PortfolioRepository } from "../../portfolio/repositories/portfolio.repository";
import { PortfolioService } from "../../portfolio/portfolio.service";
import { OrderRepository } from "../../orders/repositories/order.repository";
import { TokensService } from "../../tokens/tokens.service";
import { HEALTH_FACTOR_NO_DEBT } from "../../portfolio/helpers/health-factor.helpers";

jest.mock("../../core/on-chain-state/apply-withdraw", () => ({
    applyWithdrawEffects: jest.fn().mockResolvedValue(undefined),
}));
import { applyWithdrawEffects } from "../../core/on-chain-state/apply-withdraw";

const WALLET = "0x1111111111111111111111111111111111111111";
const ASSET_ID = "asset-uuid-123";
const ACCOUNT = { id: "account-uuid-456" };
const TOKEN = {
    id: ASSET_ID,
    tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    decimals: 6,
    symbol: "USDC",
};

const TX_RECEIPT: TransactionReceipt = {
    transactionHash: "0x" + "ab".repeat(32),
    blockHash: "0x" + "cd".repeat(32),
    blockNumber: 1n,
    status: "success",
    logs: [],
} as unknown as TransactionReceipt;

describe("WithdrawService (C3 Phase 2)", () => {
    let service: WithdrawService;
    let portfolioRepository: jest.Mocked<PortfolioRepository>;
    let portfolioService: jest.Mocked<PortfolioService>;
    let orderRepository: jest.Mocked<OrderRepository>;
    let tokensService: jest.Mocked<TokensService>;
    let viemService: jest.Mocked<ViemService>;

    beforeEach(async () => {
        (applyWithdrawEffects as jest.Mock).mockClear();
        (applyWithdrawEffects as jest.Mock).mockResolvedValue(undefined);

        portfolioRepository = {
            getUserBalanceForAsset: jest.fn(),
        } as unknown as jest.Mocked<PortfolioRepository>;

        portfolioService = {
            simulateHealthFactorAfterWithdrawal: jest.fn(),
        } as unknown as jest.Mocked<PortfolioService>;

        orderRepository = {
            findAccountByWallet: jest.fn().mockResolvedValue(ACCOUNT),
        } as unknown as jest.Mocked<OrderRepository>;

        tokensService = {
            getTokenByAssetId: jest.fn().mockResolvedValue(TOKEN),
        } as unknown as jest.Mocked<TokensService>;

        viemService = {
            writeContract: jest.fn().mockResolvedValue(TX_RECEIPT),
            getPublicClient: jest.fn().mockReturnValue({}),
        } as unknown as jest.Mocked<ViemService>;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                WithdrawService,
                { provide: ViemService, useValue: viemService },
                { provide: TokensService, useValue: tokensService },
                {
                    provide: PortfolioRepository,
                    useValue: portfolioRepository,
                },
                { provide: PortfolioService, useValue: portfolioService },
                { provide: OrderRepository, useValue: orderRepository },
                {
                    provide: ChainConfigService,
                    useValue: {
                        chainId: 421614,
                        operatorPrivateKey: "0xabc123",
                        hubDepositorAddress:
                            "0xdddddddddddddddddddddddddddddddddddddddd",
                    },
                },
                {
                    provide: DatabaseService,
                    useValue: { getPool: jest.fn().mockReturnValue({}) },
                },
            ],
        }).compile();

        service = module.get<WithdrawService>(WithdrawService);
    });

    describe("validation", () => {
        it("rejects when amount is zero", async () => {
            await expect(
                service.withdraw({ assetId: ASSET_ID, amount: "0" }, WALLET),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it("rejects when amount is negative", async () => {
            await expect(
                service.withdraw({ assetId: ASSET_ID, amount: "-5" }, WALLET),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it("rejects when amount is not a number", async () => {
            await expect(
                service.withdraw({ assetId: ASSET_ID, amount: "abc" }, WALLET),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it("rejects when account not found", async () => {
            orderRepository.findAccountByWallet.mockResolvedValue(null);
            await expect(
                service.withdraw({ assetId: ASSET_ID, amount: "1" }, WALLET),
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it("rejects when token not found", async () => {
            tokensService.getTokenByAssetId.mockResolvedValue(null as never);
            await expect(
                service.withdraw({ assetId: ASSET_ID, amount: "1" }, WALLET),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe("balance lookup", () => {
        it("rejects when no balance row exists for the asset", async () => {
            portfolioRepository.getUserBalanceForAsset.mockResolvedValue(null);
            await expect(
                service.withdraw({ assetId: ASSET_ID, amount: "1" }, WALLET),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(viemService.writeContract).not.toHaveBeenCalled();
            expect(applyWithdrawEffects).not.toHaveBeenCalled();
        });

        it("rejects when balance row exists but available is zero", async () => {
            portfolioRepository.getUserBalanceForAsset.mockResolvedValue({
                available: "0",
                isCollateral: false,
                decimals: 6,
            });
            await expect(
                service.withdraw({ assetId: ASSET_ID, amount: "1" }, WALLET),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(viemService.writeContract).not.toHaveBeenCalled();
        });

        it("rejects when requested amount exceeds available", async () => {
            portfolioRepository.getUserBalanceForAsset.mockResolvedValue({
                available: "50000000", // 50 USDC
                isCollateral: false,
                decimals: 6,
            });
            await expect(
                service.withdraw({ assetId: ASSET_ID, amount: "100" }, WALLET),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(viemService.writeContract).not.toHaveBeenCalled();
        });
    });

    describe("non-collateral withdrawal (HF check skipped)", () => {
        beforeEach(() => {
            portfolioRepository.getUserBalanceForAsset.mockResolvedValue({
                available: "1000000000", // 1000 USDC
                isCollateral: false,
                decimals: 6,
            });
        });

        it("submits the on-chain payout and delegates persistence", async () => {
            const result = await service.withdraw(
                { assetId: ASSET_ID, amount: "100" },
                WALLET,
            );

            expect(result).toEqual({
                txHash: TX_RECEIPT.transactionHash,
                status: "success",
            });
            expect(viemService.writeContract).toHaveBeenCalledWith(
                421614,
                "0xabc123",
                "0xdddddddddddddddddddddddddddddddddddddddd",
                expect.anything(),
                "payout",
                [WALLET, TOKEN.tokenAddress, 100000000n],
                { waitForReceipt: true },
            );
            expect(applyWithdrawEffects).toHaveBeenCalledTimes(1);
            expect(applyWithdrawEffects).toHaveBeenCalledWith(
                expect.objectContaining({
                    receipt: TX_RECEIPT,
                    expectedUser: WALLET,
                }),
            );
        });

        it("does NOT call simulateHealthFactorAfterWithdrawal", async () => {
            await service.withdraw(
                { assetId: ASSET_ID, amount: "100" },
                WALLET,
            );
            expect(
                portfolioService.simulateHealthFactorAfterWithdrawal,
            ).not.toHaveBeenCalled();
        });
    });

    describe("collateral withdrawal (HF check fires)", () => {
        beforeEach(() => {
            portfolioRepository.getUserBalanceForAsset.mockResolvedValue({
                available: "1000000000",
                isCollateral: true,
                decimals: 6,
            });
        });

        it("allows the withdrawal when HF = NO_DEBT (no borrow open)", async () => {
            portfolioService.simulateHealthFactorAfterWithdrawal.mockResolvedValue(
                {
                    collateralUsd: 400,
                    debtUsd: 0,
                    weightedLtvDecimal: 0.75,
                    healthFactor: HEALTH_FACTOR_NO_DEBT,
                },
            );

            const result = await service.withdraw(
                { assetId: ASSET_ID, amount: "100" },
                WALLET,
            );

            expect(result.status).toBe("success");
            expect(
                portfolioService.simulateHealthFactorAfterWithdrawal,
            ).toHaveBeenCalledWith(ACCOUNT.id, ASSET_ID, "100000000");
        });

        it("allows the withdrawal when projected HF stays above 1", async () => {
            portfolioService.simulateHealthFactorAfterWithdrawal.mockResolvedValue(
                {
                    collateralUsd: 900,
                    debtUsd: 100,
                    weightedLtvDecimal: 0.75,
                    healthFactor: 6.0,
                },
            );

            const result = await service.withdraw(
                { assetId: ASSET_ID, amount: "100" },
                WALLET,
            );
            expect(result.status).toBe("success");
        });

        it("rejects when projected HF drops below 1", async () => {
            portfolioService.simulateHealthFactorAfterWithdrawal.mockResolvedValue(
                {
                    collateralUsd: 50,
                    debtUsd: 100,
                    weightedLtvDecimal: 0.75,
                    healthFactor: 0.5,
                },
            );

            await expect(
                service.withdraw({ assetId: ASSET_ID, amount: "900" }, WALLET),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(viemService.writeContract).not.toHaveBeenCalled();
            expect(applyWithdrawEffects).not.toHaveBeenCalled();
        });

        it("rejects when projected HF is exactly 1.0 (boundary)", async () => {
            portfolioService.simulateHealthFactorAfterWithdrawal.mockResolvedValue(
                {
                    collateralUsd: 100,
                    debtUsd: 100,
                    weightedLtvDecimal: 0.75,
                    healthFactor: 1.0,
                },
            );

            await expect(
                service.withdraw({ assetId: ASSET_ID, amount: "5" }, WALLET),
            ).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe("error handling", () => {
        beforeEach(() => {
            portfolioRepository.getUserBalanceForAsset.mockResolvedValue({
                available: "1000000000",
                isCollateral: false,
                decimals: 6,
            });
        });

        it("does not call applyWithdrawEffects when the on-chain write fails", async () => {
            viemService.writeContract.mockRejectedValue(
                new Error("Network error"),
            );

            await expect(
                service.withdraw({ assetId: ASSET_ID, amount: "100" }, WALLET),
            ).rejects.toThrow();
            expect(applyWithdrawEffects).not.toHaveBeenCalled();
        });

        it("surfaces InternalServerErrorException on contract revert without InsufficientFunds match", async () => {
            viemService.writeContract.mockRejectedValue(
                new Error("Contract execution reverted: SomethingElse"),
            );

            await expect(
                service.withdraw({ assetId: ASSET_ID, amount: "100" }, WALLET),
            ).rejects.toBeInstanceOf(InternalServerErrorException);
        });

        it("surfaces InternalServerErrorException when eager-write fails after a confirmed payout", async () => {
            (applyWithdrawEffects as jest.Mock).mockRejectedValueOnce(
                new Error("postgres unreachable"),
            );

            await expect(
                service.withdraw({ assetId: ASSET_ID, amount: "100" }, WALLET),
            ).rejects.toBeInstanceOf(InternalServerErrorException);
        });
    });
});
