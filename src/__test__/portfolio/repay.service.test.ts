import { Test, TestingModule } from "@nestjs/testing";
import { RepayService } from "../../portfolio/repay.service";
import { ViemService } from "../../core/viem/viem.service";
import { TokensService } from "../../tokens/tokens.service";
import { OrderRepository } from "../../orders/repositories/order.repository";
import { RepayRepository } from "../../portfolio/repositories/repay.repository";
import { PortfolioRepository } from "../../portfolio/repositories/portfolio.repository";
import { MarketRepositories } from "../../market/repository/market.repository";
import { ChainConfigService } from "../../core/chain-config/chain-config.service";
import {
    BadRequestException,
    NotFoundException,
    InternalServerErrorException,
} from "@nestjs/common";
import { parseUnits } from "viem";
import { DataSource, EntityManager } from "typeorm";

describe("RepayService", () => {
    let service: RepayService;
    let viemService: jest.Mocked<ViemService>;
    let orderRepository: jest.Mocked<OrderRepository>;
    let repayRepository: jest.Mocked<RepayRepository>;
    let portfolioRepository: jest.Mocked<PortfolioRepository>;
    let chainConfig: jest.Mocked<ChainConfigService>;
    let dataSource: jest.Mocked<DataSource>;
    let manager: jest.Mocked<EntityManager>;

    beforeEach(async () => {
        viemService = {
            writeContract: jest.fn(),
            readContract: jest.fn(),
        } as any;

        orderRepository = {
            getOrCreateAccount: jest.fn(),
        } as any;

        manager = {
            createQueryBuilder: jest.fn(),
        } as any;

        dataSource = {
            transaction: jest.fn(
                async (cb: (m: EntityManager) => Promise<any>) =>
                    await cb(manager),
            ),
        } as any;

        repayRepository = {
            getBorrowPositionById: jest.fn(),
            getMarketWithAsset: jest.fn(),
            getUserTotalDebt: jest.fn(),
            getBorrowPositions: jest.fn(),
            updateBorrowPositionDebt: jest.fn(),
        } as any;

        portfolioRepository = {
            upsertPortfolio: jest.fn(),
        } as any;

        chainConfig = {
            chainId: 421614,
            operatorPrivateKey: "0xoperator",
            treasuryAddress: "",
            centuariAddress: "0xcentuari",
        } as any;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RepayService,
                { provide: ViemService, useValue: viemService },
                { provide: OrderRepository, useValue: orderRepository },
                { provide: RepayRepository, useValue: repayRepository },
                {
                    provide: PortfolioRepository,
                    useValue: portfolioRepository,
                },
                { provide: ChainConfigService, useValue: chainConfig },
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
        const account = { id: "acc-1" };
        const market = {
            id: marketId,
            assetId,
            maturity: maturity.toISOString(),
            decimals: 18,
            tokenAddress: "0xtoken",
        };

        it("should successfully repay with FIFO deduction across positions", async () => {
            const positions = [
                { id: "pos-1", debt: parseUnits("60", 18).toString() },
                { id: "pos-2", debt: parseUnits("140", 18).toString() },
            ];

            orderRepository.getOrCreateAccount.mockResolvedValue(
                account as any,
            );
            repayRepository.getMarketWithAsset.mockResolvedValue(market as any);
            repayRepository.getUserTotalDebt.mockResolvedValue(
                parseUnits("200", 18).toString(),
            );
            // On-chain debt check
            viemService.readContract.mockResolvedValue(parseUnits("200", 18));
            viemService.writeContract.mockResolvedValue({
                transactionHash: "0xtx",
            } as any);
            repayRepository.getBorrowPositions.mockResolvedValue(
                positions as any,
            );

            const result = await service.repay(dto, walletAddress, privyUserId);

            expect(result).toEqual({ txHash: "0xtx", status: "success" });
            expect(repayRepository.getMarketWithAsset).toHaveBeenCalledWith(
                marketId,
            );
            // FIFO: first position fully repaid (60), second partially (40)
            expect(
                repayRepository.updateBorrowPositionDebt,
            ).toHaveBeenCalledTimes(2);
            expect(
                repayRepository.updateBorrowPositionDebt,
            ).toHaveBeenNthCalledWith(1, manager, "pos-1", "0");
            expect(
                repayRepository.updateBorrowPositionDebt,
            ).toHaveBeenNthCalledWith(
                2,
                manager,
                "pos-2",
                (parseUnits("140", 18) - parseUnits("40", 18)).toString(),
            );
        });

        it("should throw NotFoundException if no active positions found", async () => {
            orderRepository.getOrCreateAccount.mockResolvedValue(
                account as any,
            );
            repayRepository.getMarketWithAsset.mockResolvedValue(market as any);
            repayRepository.getUserTotalDebt.mockResolvedValue("0");

            await expect(
                service.repay(dto, walletAddress, privyUserId),
            ).rejects.toThrow(NotFoundException);
        });

        it("should throw BadRequestException if repay amount > total debt", async () => {
            orderRepository.getOrCreateAccount.mockResolvedValue(
                account as any,
            );
            repayRepository.getMarketWithAsset.mockResolvedValue(market as any);
            repayRepository.getUserTotalDebt.mockResolvedValue(
                parseUnits("50", 18).toString(),
            );
            // On-chain debt check
            viemService.readContract.mockResolvedValue(parseUnits("50", 18));

            await expect(
                service.repay(dto, walletAddress, privyUserId),
            ).rejects.toThrow(BadRequestException);
        });
    });
});
