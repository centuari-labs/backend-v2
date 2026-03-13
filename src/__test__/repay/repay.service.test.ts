import { Test, TestingModule } from "@nestjs/testing";
import { RepayService } from "../../repay/repay.service";
import { ViemService } from "../../core/viem/viem.service";
import { TokensService } from "../../tokens/tokens.service";
import { OrderRepository } from "../../orders/repositories/order.repository";
import { RepayRepository } from "../../repay/repositories/repay.repository";
import { MarketRepositories } from "../../market/repository/market.repository";
import { ConfigService } from "@nestjs/config";
import { BadRequestException, NotFoundException, InternalServerErrorException } from "@nestjs/common";
import { parseUnits } from "viem";
import { DataSource, EntityManager } from "typeorm";

describe("RepayService", () => {
    let service: RepayService;
    let viemService: jest.Mocked<ViemService>;
    let orderRepository: jest.Mocked<OrderRepository>;
    let repayRepository: jest.Mocked<RepayRepository>;
    let configService: jest.Mocked<ConfigService>;
    let dataSource: jest.Mocked<DataSource>;
    let manager: jest.Mocked<EntityManager>;

    beforeEach(async () => {
        viemService = {
            writeContract: jest.fn(),
        } as any;

        orderRepository = {
            getOrCreateAccount: jest.fn(),
        } as any;

        manager = {
            createQueryBuilder: jest.fn(),
        } as any;

        dataSource = {
            transaction: jest.fn(async (cb: (m: EntityManager) => Promise<any>) => await cb(manager)),
        } as any;

        repayRepository = {
            getMarketWithAsset: jest.fn(),
            getUserTotalDebt: jest.fn(),
            getBorrowPositions: jest.fn(),
            updateBorrowPositionDebt: jest.fn(),
        } as any;

        configService = {
            get: jest.fn((key: string) => {
                if (key === "DEPOSIT_CHAIN_ID") return "421614";
                if (key === "OPERATOR_PRIVATE_KEY") return "0xoperator";
                if (key === "CENTUARI_ADDRESS") return "0xcentuari";
                return null;
            }),
        } as any;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RepayService,
                { provide: ViemService, useValue: viemService },
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
        const privyUserId = "privy-1";
        const marketId = "market-1";
        const assetId = "asset-1";
        const maturity = new Date(1710240000 * 1000);
        const dto = { marketId, amount: "100" };
        const token = {
            id: assetId,
            tokenAddress: "0xtoken",
            decimals: 18,
        };
        const account = { id: "acc-1" };
        const market = { id: marketId, assetId, maturity: maturity.toISOString(), decimals: 18, tokenAddress: "0xtoken" };

        it("should successfully repay part of a borrow position", async () => {
            orderRepository.getOrCreateAccount.mockResolvedValue(account as any);
            repayRepository.getMarketWithAsset.mockResolvedValue(market as any);
            repayRepository.getUserTotalDebt.mockResolvedValue(parseUnits("200", 18).toString());
            repayRepository.getBorrowPositions.mockResolvedValue([
                { id: "pos-1", debt: parseUnits("200", 18).toString() }
            ]);
            viemService.writeContract.mockResolvedValue({ transactionHash: "0xtx" } as any);

            const result = await service.repay(dto, walletAddress, privyUserId);

            expect(result).toEqual({ txHash: "0xtx", status: "success" });
            expect(repayRepository.getMarketWithAsset).toHaveBeenCalledWith(marketId);
            expect(repayRepository.updateBorrowPositionDebt).toHaveBeenCalledWith(manager, "pos-1", parseUnits("100", 18).toString());
        });

        it("should throw NotFoundException if market not found", async () => {
            orderRepository.getOrCreateAccount.mockResolvedValue(account as any);
            repayRepository.getMarketWithAsset.mockResolvedValue(null);

            await expect(service.repay(dto, walletAddress, privyUserId)).rejects.toThrow(NotFoundException);
        });

        it("should throw BadRequestException if repay amount > total debt", async () => {
            orderRepository.getOrCreateAccount.mockResolvedValue(account as any);
            repayRepository.getMarketWithAsset.mockResolvedValue(market as any);
            repayRepository.getUserTotalDebt.mockResolvedValue(parseUnits("50", 18).toString());

            await expect(service.repay(dto, walletAddress, privyUserId)).rejects.toThrow(BadRequestException);
        });
    });
});
