import {
    BadRequestException,
    InternalServerErrorException,
    NotFoundException,
} from "@nestjs/common";
import { WithdrawService } from "../../withdraw/withdraw.service";
import { HEALTH_FACTOR_NO_DEBT } from "../../portfolio/helpers/health-factor.helpers";

const mockViemService = {
    writeContract: jest.fn(),
};

const mockTokensService = {
    getTokenByAssetId: jest.fn(),
};

const mockQueryRunner = {
    connect: jest.fn(),
    isTransactionActive: false,
    startTransaction: jest.fn().mockImplementation(() => {
        mockQueryRunner.isTransactionActive = true;
    }),
    commitTransaction: jest.fn().mockImplementation(() => {
        mockQueryRunner.isTransactionActive = false;
    }),
    rollbackTransaction: jest.fn().mockImplementation(() => {
        mockQueryRunner.isTransactionActive = false;
    }),
    release: jest.fn(),
    manager: {
        createQueryBuilder: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn(),
        save: jest.fn(),
        remove: jest.fn(),
    } as any,
};

const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
};

const mockPortfolioRepository = {};

const mockPortfolioService = {
    simulateHealthFactorAfterWithdrawal: jest.fn(),
};

const mockOrderRepository = {
    findAccountByWallet: jest.fn(),
};

const mockChainConfig = {
    chainId: 421614,
    operatorPrivateKey: "0xabc123",
    hubDepositorAddress: "0xHubDepositor",
    centuariAddress: "",
};

describe("WithdrawService", () => {
    let service: WithdrawService;

    beforeEach(() => {
        jest.resetAllMocks();
        mockDataSource.createQueryRunner.mockReturnValue(mockQueryRunner);

        // Setup manager method chaining
        mockQueryRunner.manager.createQueryBuilder.mockReturnThis();
        mockQueryRunner.manager.setLock.mockReturnThis();
        mockQueryRunner.manager.where.mockReturnThis();
        mockQueryRunner.manager.andWhere.mockReturnThis();

        // Setup transaction state behavior
        mockQueryRunner.isTransactionActive = false;
        mockQueryRunner.startTransaction.mockImplementation(() => {
            mockQueryRunner.isTransactionActive = true;
        });
        mockQueryRunner.rollbackTransaction.mockImplementation(() => {
            mockQueryRunner.isTransactionActive = false;
        });
        mockQueryRunner.commitTransaction.mockImplementation(() => {
            mockQueryRunner.isTransactionActive = false;
        });

        service = new WithdrawService(
            mockDataSource as any,
            mockViemService as any,
            mockTokensService as any,
            mockPortfolioRepository as any,
            mockPortfolioService as any,
            mockOrderRepository as any,
            mockChainConfig as any,
        );
    });

    const walletAddress = "0xUserWallet";
    const assetId = "asset-uuid-123";
    const mockAccount = { id: "account-uuid-456" };
    const mockToken = {
        id: assetId,
        tokenAddress: "0xTokenAddr",
        decimals: 6,
        symbol: "USDC",
    };

    describe("successful withdrawal", () => {
        it("returns txHash on success (non-collateral only)", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.manager.getMany.mockResolvedValueOnce([
                {
                    id: "portfolio-row-id",
                    amount: "1000000000",
                    isCollateral: false,
                },
            ]);
            mockQueryRunner.manager.save.mockResolvedValue(undefined);
            mockViemService.writeContract.mockResolvedValue({
                transactionHash: "0xTxHash123",
            });

            const result = await service.withdraw(
                { assetId, amount: "100" },
                walletAddress,
            );

            expect(result).toEqual({
                txHash: "0xTxHash123",
                status: "success",
            });
            expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
            expect(mockQueryRunner.release).toHaveBeenCalled();
        });

        it("calls viemService.writeContract with correct args", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.manager.getMany.mockResolvedValueOnce([
                {
                    id: "portfolio-row-id",
                    amount: "1000000000",
                    isCollateral: false,
                },
            ]);
            mockQueryRunner.manager.save.mockResolvedValue(undefined);
            mockViemService.writeContract.mockResolvedValue({
                transactionHash: "0xTxHash123",
            });

            await service.withdraw({ assetId, amount: "100" }, walletAddress);

            expect(mockViemService.writeContract).toHaveBeenCalledWith(
                421614,
                "0xabc123",
                "0xHubDepositor",
                expect.anything(), // HubDepositorAbi
                "payout",
                [walletAddress, "0xTokenAddr", 100000000n], // payout(user, asset, amount)
                { waitForReceipt: true },
            );
        });

        it("deletes portfolio row when balance is fully withdrawn", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.manager.getMany.mockResolvedValueOnce([
                {
                    id: "portfolio-row-id",
                    amount: "100000000",
                    isCollateral: false,
                },
            ]);
            mockQueryRunner.manager.remove.mockResolvedValue(undefined);
            mockViemService.writeContract.mockResolvedValue({
                transactionHash: "0xTxHash",
            });

            await service.withdraw({ assetId, amount: "100" }, walletAddress);

            expect(mockQueryRunner.manager.remove).toHaveBeenCalledWith(
                expect.objectContaining({ id: "portfolio-row-id" }),
            );
        });

        it("updates portfolio row for partial withdrawal", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.manager.getMany.mockResolvedValueOnce([
                {
                    id: "portfolio-row-id",
                    amount: "1000000000",
                    isCollateral: false,
                },
            ]);
            mockQueryRunner.manager.save.mockResolvedValue(undefined);
            mockViemService.writeContract.mockResolvedValue({
                transactionHash: "0xTxHash",
            });

            await service.withdraw({ assetId, amount: "300" }, walletAddress);

            expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: "portfolio-row-id",
                    amount: "700000000",
                }),
            );
        });
    });

    describe("collateral withdrawal", () => {
        it("allows withdrawing collateral when no debt (HF = Infinity)", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.manager.getMany.mockResolvedValueOnce([
                {
                    id: "collateral-row-id",
                    amount: "500000000",
                    isCollateral: true,
                },
            ]);
            mockQueryRunner.manager.save.mockResolvedValue(undefined);
            mockQueryRunner.manager.remove.mockResolvedValue(undefined);
            mockPortfolioService.simulateHealthFactorAfterWithdrawal.mockResolvedValue(
                {
                    collateralUsd: 400,
                    debtUsd: 0,
                    weightedLtvDecimal: 0.75,
                    healthFactor: HEALTH_FACTOR_NO_DEBT,
                },
            );
            mockViemService.writeContract.mockResolvedValue({
                transactionHash: "0xTxHash",
            });

            const result = await service.withdraw(
                { assetId, amount: "100" },
                walletAddress,
            );

            expect(result.status).toBe("success");
            expect(
                mockPortfolioService.simulateHealthFactorAfterWithdrawal,
            ).toHaveBeenCalledWith(
                mockAccount.id,
                assetId,
                "100000000", // humanToBaseUnits("100", 6)
            );
        });

        it("allows withdrawing collateral when HF stays above 1", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.manager.getMany.mockResolvedValueOnce([
                {
                    id: "collateral-row-id",
                    amount: "1000000000",
                    isCollateral: true,
                },
            ]);
            mockQueryRunner.manager.save.mockResolvedValue(undefined);
            mockPortfolioService.simulateHealthFactorAfterWithdrawal.mockResolvedValue(
                {
                    collateralUsd: 900,
                    debtUsd: 100,
                    weightedLtvDecimal: 0.75,
                    healthFactor: 6.0,
                },
            );
            mockViemService.writeContract.mockResolvedValue({
                transactionHash: "0xTxHash",
            });

            const result = await service.withdraw(
                { assetId, amount: "100" },
                walletAddress,
            );

            expect(result.status).toBe("success");
        });

        it("rejects collateral withdrawal when HF would drop below 1", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.manager.getMany.mockResolvedValueOnce([
                {
                    id: "collateral-row-id",
                    amount: "1000000000",
                    isCollateral: true,
                },
            ]);
            mockPortfolioService.simulateHealthFactorAfterWithdrawal.mockResolvedValue(
                {
                    collateralUsd: 50,
                    debtUsd: 100,
                    weightedLtvDecimal: 0.75,
                    healthFactor: 0.5,
                },
            );

            await expect(
                service.withdraw({ assetId, amount: "900" }, walletAddress),
            ).rejects.toThrow(BadRequestException);
            expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
        });

        it("deducts from non-collateral first, then collateral", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.manager.getMany.mockResolvedValueOnce([
                {
                    id: "non-coll-id",
                    amount: "300000000",
                    isCollateral: false,
                },
                { id: "coll-id", amount: "700000000", isCollateral: true },
            ]);
            mockQueryRunner.manager.save.mockResolvedValue(undefined);
            mockQueryRunner.manager.remove.mockResolvedValue(undefined);
            mockPortfolioService.simulateHealthFactorAfterWithdrawal.mockResolvedValue(
                {
                    collateralUsd: 500,
                    debtUsd: 50,
                    weightedLtvDecimal: 0.75,
                    healthFactor: 6.75,
                },
            );
            mockViemService.writeContract.mockResolvedValue({
                transactionHash: "0xTxHash",
            });

            await service.withdraw({ assetId, amount: "500" }, walletAddress);

            // Non-collateral fully depleted (300) → remove
            expect(mockQueryRunner.manager.remove).toHaveBeenCalledWith(
                expect.objectContaining({ id: "non-coll-id" }),
            );
            // Collateral partially depleted (200000000 from 700000000) → save to 500000000
            expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
                expect.objectContaining({ id: "coll-id", amount: "500000000" }),
            );
            // HF check should only use the collateral deduction (200)
            expect(
                mockPortfolioService.simulateHealthFactorAfterWithdrawal,
            ).toHaveBeenCalledWith(
                mockAccount.id,
                assetId,
                "200000000", // humanToBaseUnits("200", 6)
            );
        });

        it("skips HF check when only non-collateral is touched", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.manager.getMany.mockResolvedValueOnce([
                {
                    id: "non-coll-id",
                    amount: "500000000",
                    isCollateral: false,
                },
                { id: "coll-id", amount: "500000000", isCollateral: true },
            ]);
            mockQueryRunner.manager.save.mockResolvedValue(undefined);
            mockViemService.writeContract.mockResolvedValue({
                transactionHash: "0xTxHash",
            });

            await service.withdraw({ assetId, amount: "300" }, walletAddress);

            expect(
                mockPortfolioService.simulateHealthFactorAfterWithdrawal,
            ).not.toHaveBeenCalled();
        });
    });

    describe("validation errors", () => {
        it("rejects when amount is zero", async () => {
            await expect(
                service.withdraw({ assetId, amount: "0" }, walletAddress),
            ).rejects.toThrow(BadRequestException);
        });

        it("rejects when amount is negative", async () => {
            await expect(
                service.withdraw({ assetId, amount: "-5" }, walletAddress),
            ).rejects.toThrow(BadRequestException);
        });

        it("rejects when amount is not a number", async () => {
            await expect(
                service.withdraw({ assetId, amount: "abc" }, walletAddress),
            ).rejects.toThrow(BadRequestException);
        });

        it("rejects when account not found", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(null);

            await expect(
                service.withdraw({ assetId, amount: "100" }, walletAddress),
            ).rejects.toThrow(NotFoundException);
        });

        it("rejects when token not found", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(null);

            await expect(
                service.withdraw({ assetId, amount: "100" }, walletAddress),
            ).rejects.toThrow(NotFoundException);
        });

        it("rejects when no balance found for asset", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.manager.getMany.mockResolvedValueOnce([]);

            await expect(
                service.withdraw({ assetId, amount: "100" }, walletAddress),
            ).rejects.toThrow(BadRequestException);
            expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
        });

        it("rejects when insufficient total balance", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.manager.getMany.mockResolvedValueOnce([
                { id: "non-coll-id", amount: "30000000", isCollateral: false },
                { id: "coll-id", amount: "20000000", isCollateral: true },
            ]);

            await expect(
                service.withdraw({ assetId, amount: "100" }, walletAddress),
            ).rejects.toThrow(BadRequestException);
            expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
        });
    });

    describe("edge cases", () => {
        it("should reject withdrawal when HF is exactly 1.0 (boundary)", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            // Only collateral row, no non-collateral
            mockQueryRunner.manager.getMany.mockResolvedValueOnce([
                {
                    id: "collateral-row-id",
                    amount: "10000000",
                    lockedAmount: "0",
                    isCollateral: true,
                },
            ]);
            mockPortfolioService.simulateHealthFactorAfterWithdrawal.mockResolvedValue(
                {
                    healthFactor: 1.0, // Exactly 1.0 — should be rejected (uses <= check)
                    collateralUsd: 100,
                    debtUsd: 100,
                    weightedLtvDecimal: 0.75,
                },
            );

            await expect(
                service.withdraw({ assetId, amount: "5" }, walletAddress),
            ).rejects.toThrow(BadRequestException);
        });

        it("should deduct from both collateral and non-collateral when needed", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            // Non-collateral has 3, collateral has 10 — withdrawing 5
            mockQueryRunner.manager.getMany.mockResolvedValueOnce([
                {
                    id: "non-collateral-row",
                    amount: "3000000",
                    lockedAmount: "0",
                    isCollateral: false,
                },
                {
                    id: "collateral-row",
                    amount: "10000000",
                    lockedAmount: "0",
                    isCollateral: true,
                },
            ]);
            mockPortfolioService.simulateHealthFactorAfterWithdrawal.mockResolvedValue(
                {
                    healthFactor: 5.0,
                    collateralUsd: 500,
                    debtUsd: 100,
                    weightedLtvDecimal: 0.75,
                },
            );
            mockViemService.writeContract.mockResolvedValue({
                transactionHash: "0xtxhash",
            });
            mockQueryRunner.manager.remove.mockResolvedValue(undefined);
            mockQueryRunner.manager.save.mockResolvedValue(undefined);

            const result = await service.withdraw(
                { assetId, amount: "5" },
                walletAddress,
            );

            expect(result.status).toBe("success");
            // Non-collateral should be deleted (3 - 3 = 0), collateral reduced (10 - 2 = 8)
            expect(mockQueryRunner.manager.remove).toHaveBeenCalledWith(
                expect.objectContaining({ id: "non-collateral-row" }),
            );
        });

        it("should handle case where only collateral row exists", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            // Only collateral row
            mockQueryRunner.manager.getMany.mockResolvedValueOnce([
                {
                    id: "collateral-row",
                    amount: "10000000",
                    lockedAmount: "0",
                    isCollateral: true,
                },
            ]);
            mockPortfolioService.simulateHealthFactorAfterWithdrawal.mockResolvedValue(
                {
                    healthFactor: HEALTH_FACTOR_NO_DEBT,
                    collateralUsd: 500,
                    debtUsd: 0,
                    weightedLtvDecimal: 0.75,
                },
            );
            mockViemService.writeContract.mockResolvedValue({
                transactionHash: "0xtxhash",
            });
            mockQueryRunner.manager.save.mockResolvedValue(undefined);

            const result = await service.withdraw(
                { assetId, amount: "5" },
                walletAddress,
            );

            expect(result.status).toBe("success");
        });

        it("should delete portfolio row when remaining amount reaches zero", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.manager.getMany.mockResolvedValueOnce([
                {
                    id: "non-collateral-row",
                    amount: "5000000", // exactly 5 USDC
                    lockedAmount: "0",
                    isCollateral: false,
                },
            ]);
            mockViemService.writeContract.mockResolvedValue({
                transactionHash: "0xtxhash",
            });
            mockQueryRunner.manager.remove.mockResolvedValue(undefined);

            const result = await service.withdraw(
                { assetId, amount: "5" },
                walletAddress,
            );

            expect(result.status).toBe("success");
            // Should remove the row since amount reaches 0
            expect(mockQueryRunner.manager.remove).toHaveBeenCalledWith(
                expect.objectContaining({ id: "non-collateral-row" }),
            );
        });

        it("should rollback transaction when blockchain writeContract fails", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.manager.getMany.mockResolvedValueOnce([
                {
                    id: "row-id",
                    amount: "10000000",
                    lockedAmount: "0",
                    isCollateral: false,
                },
            ]);
            mockViemService.writeContract.mockRejectedValue(
                new Error("Network error"),
            );

            await expect(
                service.withdraw({ assetId, amount: "5" }, walletAddress),
            ).rejects.toThrow();

            expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
            expect(mockQueryRunner.release).toHaveBeenCalled();
        });
    });

    describe("error handling", () => {
        it("rolls back transaction on contract revert", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.manager.getMany.mockResolvedValueOnce([
                {
                    id: "portfolio-row-id",
                    amount: "10000000000",
                    isCollateral: false,
                },
            ]);
            mockViemService.writeContract.mockRejectedValue(
                new Error("Contract execution reverted"),
            );

            await expect(
                service.withdraw({ assetId, amount: "100" }, walletAddress),
            ).rejects.toThrow(InternalServerErrorException);
            expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
            expect(mockQueryRunner.release).toHaveBeenCalled();
        });
    });
});
