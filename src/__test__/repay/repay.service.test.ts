import { Test, TestingModule } from "@nestjs/testing";
import { RepayService } from "../../repay/repay.service";
import { ViemService } from "../../core/viem/viem.service";
import { TokensService } from "../../tokens/tokens.service";
import { OrderRepository } from "../../orders/repositories/order.repository";
import { RepayRepository } from "../../repay/repositories/repay.repository";
import { ConfigService } from "@nestjs/config";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { parseUnits } from "viem";

describe("RepayService", () => {
    let service: RepayService;
    let viemService: jest.Mocked<ViemService>;
    let tokensService: jest.Mocked<TokensService>;
    let orderRepository: jest.Mocked<OrderRepository>;
    let repayRepository: jest.Mocked<RepayRepository>;
    let configService: jest.Mocked<ConfigService>;
    let queryRunner: any;

    beforeEach(async () => {
        viemService = {
            writeContract: jest.fn(),
        } as any;

        tokensService = {
            getTokenByAssetId: jest.fn(),
        } as any;

        orderRepository = {
            findAccountByWallet: jest.fn(),
        } as any;

        queryRunner = {
            connect: jest.fn(),
            startTransaction: jest.fn(),
            commitTransaction: jest.fn(),
            rollbackTransaction: jest.fn(),
            release: jest.fn(),
            query: jest.fn(),
        };

        repayRepository = {
            getUserTotalDebt: jest.fn(),
            getBorrowPositionsForUpdate: jest.fn(),
            deleteBorrowPosition: jest.fn(),
            updateBorrowPositionDebt: jest.fn(),
            createQueryRunner: jest.fn().mockReturnValue(queryRunner),
        } as any;

        configService = {
            get: jest.fn((key: string) => {
                if (key === "DEPOSIT_CHAIN_ID") return "421614";
                if (key === "OPERATOR_PRIVATE_KEY") return "0xoperator";
                if (key === "TREASURY_ADDRESS") return "0xtreasury";
                return null;
            }),
        } as any;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RepayService,
                { provide: ViemService, useValue: viemService },
                { provide: TokensService, useValue: tokensService },
                { provide: OrderRepository, useValue: orderRepository },
                { provide: RepayRepository, useValue: repayRepository },
                { provide: ConfigService, useValue: configService },
            ],
        }).compile();

        service = module.get<RepayService>(RepayService);
    });

    describe("repay", () => {
        const walletAddress = "0xwallet";
        const assetId = "asset-123";
        const dto = { assetId, amount: "100" };
        const token = {
            id: assetId,
            tokenAddress: "0xtoken",
            decimals: 18,
            symbol: "USDC",
            name: "USD Coin",
            isLoanToken: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const account = {
            id: "acc-1",
            userWallet: walletAddress,
            privyUserId: "privy-1",
            createdAt: new Date(),
        };

        it("should successfully repay part of a borrow position", async () => {
            orderRepository.findAccountByWallet.mockResolvedValue(account as any);
            tokensService.getTokenByAssetId.mockResolvedValue(token as any);
            
            // User has 200 total debt
            repayRepository.getUserTotalDebt.mockResolvedValue(parseUnits("200", 18).toString());
            
            // User repays 100
            repayRepository.getBorrowPositionsForUpdate.mockResolvedValue([
                { id: "pos-1", debt: parseUnits("200", 18).toString() }
            ]);

            viemService.writeContract.mockResolvedValue({ transactionHash: "0xtx" } as any);

            const result = await service.repay(dto, walletAddress);

            expect(result).toEqual({ txHash: "0xtx", status: "success" });
            expect(repayRepository.updateBorrowPositionDebt).toHaveBeenCalledWith(
                queryRunner,
                "pos-1",
                parseUnits("100", 18).toString()
            );
            expect(queryRunner.commitTransaction).toHaveBeenCalled();
            expect(viemService.writeContract).toHaveBeenCalled();
        });

        it("should successfully fully repay multiple borrow positions", async () => {
            orderRepository.findAccountByWallet.mockResolvedValue(account as any);
            tokensService.getTokenByAssetId.mockResolvedValue(token as any);
            
            // User has 100 total debt spread across 2 positions
            repayRepository.getUserTotalDebt.mockResolvedValue(parseUnits("100", 18).toString());
            
            // User repays 100
            repayRepository.getBorrowPositionsForUpdate.mockResolvedValue([
                { id: "pos-1", debt: parseUnits("40", 18).toString() },
                { id: "pos-2", debt: parseUnits("60", 18).toString() },
            ]);

            viemService.writeContract.mockResolvedValue({ transactionHash: "0xtx" } as any);

            const result = await service.repay(dto, walletAddress);

            expect(result).toEqual({ txHash: "0xtx", status: "success" });
            expect(repayRepository.deleteBorrowPosition).toHaveBeenCalledWith(queryRunner, "pos-1");
            expect(repayRepository.deleteBorrowPosition).toHaveBeenCalledWith(queryRunner, "pos-2");
            expect(queryRunner.commitTransaction).toHaveBeenCalled();
        });

        it("should throw BadRequestException if repay amount > total debt", async () => {
            orderRepository.findAccountByWallet.mockResolvedValue(account as any);
            tokensService.getTokenByAssetId.mockResolvedValue(token as any);
            
            // User has 50 total debt, tries to repay 100
            repayRepository.getUserTotalDebt.mockResolvedValue(parseUnits("50", 18).toString());

            await expect(service.repay(dto, walletAddress)).rejects.toThrow(BadRequestException);
            expect(queryRunner.startTransaction).not.toHaveBeenCalled();
            expect(viemService.writeContract).not.toHaveBeenCalled();
        });

        it("should throw NotFoundException if unsupported/invalid token", async () => {
            orderRepository.findAccountByWallet.mockResolvedValue(account as any);
            tokensService.getTokenByAssetId.mockResolvedValue(null as any); // Token not found

            await expect(service.repay(dto, walletAddress)).rejects.toThrow(NotFoundException);
            expect(repayRepository.getUserTotalDebt).not.toHaveBeenCalled();
        });

        it("should throw BadRequestException if user has no debt (total debt is 0)", async () => {
            orderRepository.findAccountByWallet.mockResolvedValue(account as any);
            tokensService.getTokenByAssetId.mockResolvedValue(token as any);
            
            // Total debt is 0
            repayRepository.getUserTotalDebt.mockResolvedValue("0");

            await expect(service.repay(dto, walletAddress)).rejects.toThrow(BadRequestException);
            expect(queryRunner.startTransaction).not.toHaveBeenCalled();
        });

        it("should rollback transaction if smart contract reverts", async () => {
            orderRepository.findAccountByWallet.mockResolvedValue(account as any);
            tokensService.getTokenByAssetId.mockResolvedValue(token as any);
            repayRepository.getUserTotalDebt.mockResolvedValue(parseUnits("200", 18).toString());
            repayRepository.getBorrowPositionsForUpdate.mockResolvedValue([
                { id: "pos-1", debt: parseUnits("200", 18).toString() }
            ]);

            viemService.writeContract.mockRejectedValue(new Error("Contract reverted"));

            await expect(service.repay(dto, walletAddress)).rejects.toThrow("Contract reverted");
            
            expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
            expect(queryRunner.release).toHaveBeenCalled();
        });
    });
});
