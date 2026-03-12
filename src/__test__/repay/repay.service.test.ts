import { Test, TestingModule } from "@nestjs/testing";
import { RepayService } from "../../repay/repay.service";
import { ViemService } from "../../core/viem/viem.service";
import { TokensService } from "../../tokens/tokens.service";
import { OrderRepository } from "../../orders/repositories/order.repository";
import { RepayRepository } from "../../repay/repositories/repay.repository";
import { ConfigService } from "@nestjs/config";
import { BadRequestException, NotFoundException, InternalServerErrorException } from "@nestjs/common";
import { parseUnits } from "viem";
import { DataSource, EntityManager } from "typeorm";

describe("RepayService", () => {
    let service: RepayService;
    let viemService: jest.Mocked<ViemService>;
    let tokensService: jest.Mocked<TokensService>;
    let orderRepository: jest.Mocked<OrderRepository>;
    let repayRepository: jest.Mocked<RepayRepository>;
    let configService: jest.Mocked<ConfigService>;
    let dataSource: jest.Mocked<DataSource>;
    let manager: jest.Mocked<EntityManager>;

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

        manager = {
            createQueryBuilder: jest.fn(),
        } as any;

        dataSource = {
            transaction: jest.fn(async (cb: (m: EntityManager) => Promise<any>) => await cb(manager)),
        } as any;

        repayRepository = {
            getAssetIdByTokenAddress: jest.fn(),
            getUserTotalDebt: jest.fn(),
            getBorrowPositions: jest.fn(),
            getBorrowPositionsForUpdate: jest.fn(),
            deleteBorrowPosition: jest.fn(),
            updateBorrowPositionDebt: jest.fn(),
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
                { provide: DataSource, useValue: dataSource },
            ],
        }).compile();

        service = module.get<RepayService>(RepayService);
    });

    describe("repay", () => {
        const walletAddress = "0xwallet";
        const assetId = "0xtoken";
        const maturity = 1710240000; // Example timestamp
        const dto = { borrowerAddress: walletAddress, assetId, maturity, amount: "100" };
        const token = {
            id: "token-1",
            tokenAddress: assetId,
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
            repayRepository.getAssetIdByTokenAddress.mockResolvedValue("token-1");
            tokensService.getTokenByAssetId.mockResolvedValue(token as any);

            // User has 200 total debt
            repayRepository.getUserTotalDebt.mockResolvedValue(parseUnits("200", 18).toString());

            // User repays 100
            repayRepository.getBorrowPositions.mockResolvedValue([
                { id: "pos-1", debt: parseUnits("200", 18).toString(), maturity: new Date(maturity * 1000).toISOString() }
            ]);
            repayRepository.getBorrowPositionsForUpdate.mockResolvedValue([
                { id: "pos-1", debt: parseUnits("200", 18).toString(), maturity: maturity }
            ]);

            viemService.writeContract.mockResolvedValue({ transactionHash: "0xtx" } as any);

            const result = await service.repay(dto);

            expect(result).toEqual({ txHash: "0xtx", status: "success" });
            expect(dataSource.transaction).toHaveBeenCalled();
            expect(repayRepository.updateBorrowPositionDebt).toHaveBeenCalledWith(
                manager,
                "pos-1",
                parseUnits("100", 18).toString()
            );
            expect(viemService.writeContract).toHaveBeenCalled();
        });

        it("should successfully fully repay multiple borrow positions", async () => {
            orderRepository.findAccountByWallet.mockResolvedValue(account as any);
            repayRepository.getAssetIdByTokenAddress.mockResolvedValue("token-1");
            tokensService.getTokenByAssetId.mockResolvedValue(token as any);

            // User has 100 total debt spread across 2 positions
            repayRepository.getUserTotalDebt.mockResolvedValue(parseUnits("100", 18).toString());

            // User repays 100
            repayRepository.getBorrowPositions.mockResolvedValue([
                { id: "pos-1", debt: parseUnits("40", 18).toString(), maturity: new Date(maturity * 1000).toISOString() },
                { id: "pos-2", debt: parseUnits("60", 18).toString(), maturity: new Date(maturity * 1000).toISOString() },
            ]);
            repayRepository.getBorrowPositionsForUpdate.mockResolvedValue([
                { id: "pos-1", debt: parseUnits("40", 18).toString(), maturity: maturity },
                { id: "pos-2", debt: parseUnits("60", 18).toString(), maturity: maturity },
            ]);

            viemService.writeContract.mockResolvedValue({ transactionHash: "0xtx" } as any);

            const result = await service.repay(dto);

            expect(result).toEqual({ txHash: "0xtx", status: "success" });
            expect(dataSource.transaction).toHaveBeenCalled();
            expect(repayRepository.deleteBorrowPosition).toHaveBeenCalledWith(manager, "pos-1");
            expect(repayRepository.deleteBorrowPosition).toHaveBeenCalledWith(manager, "pos-2");
        });

        it("should throw BadRequestException if repay amount > total debt", async () => {
            orderRepository.findAccountByWallet.mockResolvedValue(account as any);
            repayRepository.getAssetIdByTokenAddress.mockResolvedValue("token-1");
            tokensService.getTokenByAssetId.mockResolvedValue(token as any);

            // User has 50 total debt, tries to repay 100
            repayRepository.getUserTotalDebt.mockResolvedValue(parseUnits("50", 18).toString());

            await expect(service.repay(dto)).rejects.toThrow(BadRequestException);
            expect(dataSource.transaction).not.toHaveBeenCalled();
            expect(viemService.writeContract).not.toHaveBeenCalled();
        });

        it("should throw NotFoundException if unsupported/invalid token", async () => {
            orderRepository.findAccountByWallet.mockResolvedValue(account as any);
            tokensService.getTokenByAssetId.mockResolvedValue(null as any); // Token not found

            await expect(service.repay(dto)).rejects.toThrow(NotFoundException);
            expect(repayRepository.getUserTotalDebt).not.toHaveBeenCalled();
        });

        it("should throw BadRequestException if user has no debt (total debt is 0)", async () => {
            orderRepository.findAccountByWallet.mockResolvedValue(account as any);
            repayRepository.getAssetIdByTokenAddress.mockResolvedValue("token-1");
            tokensService.getTokenByAssetId.mockResolvedValue(token as any);

            // Total debt is 0
            repayRepository.getUserTotalDebt.mockResolvedValue("0");

            await expect(service.repay(dto)).rejects.toThrow(BadRequestException);
            expect(dataSource.transaction).not.toHaveBeenCalled();
        });

        it("should rollback transaction if smart contract reverts", async () => {
            orderRepository.findAccountByWallet.mockResolvedValue(account as any);
            repayRepository.getAssetIdByTokenAddress.mockResolvedValue("token-1");
            tokensService.getTokenByAssetId.mockResolvedValue(token as any);
            repayRepository.getUserTotalDebt.mockResolvedValue(parseUnits("200", 18).toString());
            repayRepository.getBorrowPositions.mockResolvedValue([
                { id: "pos-1", debt: parseUnits("200", 18).toString(), maturity: new Date(maturity * 1000).toISOString() }
            ]);

            viemService.writeContract.mockRejectedValue(new Error("Contract reverted"));

            await expect(service.repay(dto)).rejects.toThrow("Contract reverted");

            expect(dataSource.transaction).not.toHaveBeenCalled();
        });

        it("should throw InternalServerErrorException if DB update fails after blockchain success", async () => {
            orderRepository.findAccountByWallet.mockResolvedValue(account as any);
            repayRepository.getAssetIdByTokenAddress.mockResolvedValue("token-1");
            tokensService.getTokenByAssetId.mockResolvedValue(token as any);
            repayRepository.getUserTotalDebt.mockResolvedValue(parseUnits("100", 18).toString());
            repayRepository.getBorrowPositions.mockResolvedValue([
                { id: "pos-1", debt: parseUnits("100", 18).toString(), maturity: new Date(maturity * 1000).toISOString() }
            ]);

            viemService.writeContract.mockResolvedValue("0xtx");
            dataSource.transaction.mockRejectedValue(new Error("DB Connection Error"));

            await expect(service.repay(dto)).rejects.toThrow(InternalServerErrorException);
        });
    });
});
