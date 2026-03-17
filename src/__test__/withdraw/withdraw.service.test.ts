import { BadRequestException, NotFoundException } from "@nestjs/common";
import { WithdrawService } from "../../withdraw/withdraw.service";

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

const mockOrderRepository = {
    findAccountByWallet: jest.fn(),
};

const mockConfigService = {
    get: jest.fn((key: string) => {
        const config: Record<string, string> = {
            DEPOSIT_CHAIN_ID: "421614",
            OPERATOR_PRIVATE_KEY: "0xabc123",
            TREASURY_ADDRESS: "0xTreasury",
        };
        return config[key];
    }),
};

describe("WithdrawService", () => {
    let service: WithdrawService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new WithdrawService(
            mockViemService as any,
            mockTokensService as any,
            mockPortfolioRepository as any,
            mockOrderRepository as any,
            mockConfigService as any,
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
        it("returns txHash on success", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.query
                .mockResolvedValueOnce([
                    { id: "portfolio-row-id", amount: "1000" },
                ]) // SELECT FOR UPDATE
                .mockResolvedValueOnce(undefined); // UPDATE
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
                    { id: "portfolio-row-id", amount: "1000" },
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
                    { id: "portfolio-row-id", amount: "100" },
                ])
                .mockResolvedValueOnce(undefined);
            mockViemService.writeContract.mockResolvedValue({
                transactionHash: "0xTxHash",
            });

            await service.withdraw({ assetId, amount: "100" }, walletAddress);

            // Should DELETE, not UPDATE
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
                    { id: "portfolio-row-id", amount: "1000" },
                ])
                .mockResolvedValueOnce(undefined);
            mockViemService.writeContract.mockResolvedValue({
                transactionHash: "0xTxHash",
            });

            await service.withdraw({ assetId, amount: "300" }, walletAddress);

            expect(mockQueryRunner.query).toHaveBeenCalledWith(
                "UPDATE portfolio SET amount = $1, updated_at = NOW() WHERE id = $2",
                ["700", "portfolio-row-id"],
            );
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

        it("rejects when no non-collateral balance found", async () => {
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

        it("rejects when insufficient balance", async () => {
            mockOrderRepository.findAccountByWallet.mockResolvedValue(
                mockAccount,
            );
            mockTokensService.getTokenByAssetId.mockResolvedValue(mockToken);
            mockQueryRunner.query.mockResolvedValueOnce([
                { id: "portfolio-row-id", amount: "50" },
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
                { id: "portfolio-row-id", amount: "1000" },
            ]);
            mockViemService.writeContract.mockRejectedValue(
                new Error("Contract execution reverted"),
            );

            await expect(
                service.withdraw({ assetId, amount: "100" }, walletAddress),
            ).rejects.toThrow("Contract execution reverted");
            expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
            expect(mockQueryRunner.release).toHaveBeenCalled();
        });
    });
});
