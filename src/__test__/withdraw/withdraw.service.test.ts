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
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    query: jest.fn(),
};

const mockPortfolioRepository = {
    manager: {
        connection: {
            createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
        },
    },
};

const mockPortfolioService = {
    simulateHealthFactorAfterWithdrawal: jest.fn(),
};

const mockOrderRepository = {
    findAccountByWallet: jest.fn(),
};

const mockChainConfig = {
    chainId: 421614,
    operatorPrivateKey: "0xabc123",
    treasuryAddress: "0xTreasury",
    centuariAddress: "",
};

describe("WithdrawService", () => {
    let service: WithdrawService;

    beforeEach(() => {
        jest.resetAllMocks();
        mockPortfolioRepository.manager.connection.createQueryRunner.mockReturnValue(
            mockQueryRunner,
        );
        service = new WithdrawService(
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
            mockQueryRunner.query
                .mockResolvedValueOnce([
                    {
                        id: "portfolio-row-id",
                        amount: "1000000000",
                        is_collateral: false,
                    },
                ])
                .mockResolvedValueOnce(undefined);
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
            mockQueryRunner.query
                .mockResolvedValueOnce([
                    {
                        id: "portfolio-row-id",
                        amount: "1000000000",
                        is_collateral: false,
                    },
                ])
                .mockResolvedValueOnce(undefined);
            mockViemService.writeContract.mockResolvedValue({
                transactionHash: "0xTxHash123",
            });

            await service.withdraw({ assetId, amount: "100" }, walletAddress);

            expect(mockViemService.writeContract).toHaveBeenCalledWith(
                421614,
                "0xabc123",
                "0xTreasury",
                expect.anything(), // treasuryAbi
                "withdraw",
                ["0xTokenAddr", walletAddress, 100000000n], // parseUnits("100", 6)
                { waitForReceipt: true },
            );
        });

        it("deletes portfolio row when balance is fully withdrawn", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.query
                .mockResolvedValueOnce([
                    {
                        id: "portfolio-row-id",
                        amount: "100000000",
                        is_collateral: false,
                    },
                ])
                .mockResolvedValueOnce(undefined);
            mockViemService.writeContract.mockResolvedValue({
                transactionHash: "0xTxHash",
            });

            await service.withdraw({ assetId, amount: "100" }, walletAddress);

            expect(mockQueryRunner.query).toHaveBeenCalledWith(
                "DELETE FROM portfolio WHERE id = $1",
                ["portfolio-row-id"],
            );
        });

        it("updates portfolio row for partial withdrawal", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.query
                .mockResolvedValueOnce([
                    {
                        id: "portfolio-row-id",
                        amount: "1000000000",
                        is_collateral: false,
                    },
                ])
                .mockResolvedValueOnce(undefined);
            mockViemService.writeContract.mockResolvedValue({
                transactionHash: "0xTxHash",
            });

            await service.withdraw({ assetId, amount: "300" }, walletAddress);

            expect(mockQueryRunner.query).toHaveBeenCalledWith(
                "UPDATE portfolio SET amount = $1, updated_at = NOW() WHERE id = $2",
                ["700000000", "portfolio-row-id"],
            );
        });
    });

    describe("collateral withdrawal", () => {
        it("allows withdrawing collateral when no debt (HF = Infinity)", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.query
                .mockResolvedValueOnce([
                    {
                        id: "collateral-row-id",
                        amount: "500000000",
                        is_collateral: true,
                    },
                ])
                .mockResolvedValueOnce(undefined);
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
            mockQueryRunner.query
                .mockResolvedValueOnce([
                    {
                        id: "collateral-row-id",
                        amount: "1000000000",
                        is_collateral: true,
                    },
                ])
                .mockResolvedValueOnce(undefined);
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
            mockQueryRunner.query.mockResolvedValueOnce([
                {
                    id: "collateral-row-id",
                    amount: "1000000000",
                    is_collateral: true,
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
            mockQueryRunner.query
                .mockResolvedValueOnce([
                    {
                        id: "non-coll-id",
                        amount: "300000000",
                        is_collateral: false,
                    },
                    { id: "coll-id", amount: "700000000", is_collateral: true },
                ])
                .mockResolvedValueOnce(undefined) // viemService call result doesn't use query
                .mockResolvedValueOnce(undefined) // DELETE non-collateral row
                .mockResolvedValueOnce(undefined); // UPDATE collateral row
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

            // Non-collateral fully depleted (300) → DELETE
            expect(mockQueryRunner.query).toHaveBeenCalledWith(
                "DELETE FROM portfolio WHERE id = $1",
                ["non-coll-id"],
            );
            // Collateral partially depleted (200000000 from 700000000) → UPDATE to 500000000
            expect(mockQueryRunner.query).toHaveBeenCalledWith(
                "UPDATE portfolio SET amount = $1, updated_at = NOW() WHERE id = $2",
                ["500000000", "coll-id"],
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
            mockQueryRunner.query
                .mockResolvedValueOnce([
                    {
                        id: "non-coll-id",
                        amount: "500000000",
                        is_collateral: false,
                    },
                    { id: "coll-id", amount: "500000000", is_collateral: true },
                ])
                .mockResolvedValueOnce(undefined);
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
            mockQueryRunner.query.mockResolvedValueOnce([]);

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
            mockQueryRunner.query.mockResolvedValueOnce([
                { id: "non-coll-id", amount: "30000000", is_collateral: false },
                { id: "coll-id", amount: "20000000", is_collateral: true },
            ]);

            await expect(
                service.withdraw({ assetId, amount: "100" }, walletAddress),
            ).rejects.toThrow(BadRequestException);
            expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
        });
    });

    describe("error handling", () => {
        it("rolls back transaction on contract revert", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.query.mockResolvedValueOnce([
                {
                    id: "portfolio-row-id",
                    amount: "10000000000",
                    is_collateral: false,
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
