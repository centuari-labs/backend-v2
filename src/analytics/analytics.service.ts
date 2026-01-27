import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Portfolio } from "./entities/portfolio.entity";
import { LendPosition } from "./entities/lend-position.entity";
import { BorrowPosition } from "./entities/borrow-position.entity";
import {
    TotalBalancePortfolioDto,
    MyAssetDto,
    MyPositionDto,
    LendPositionDto,
    BorrowPositionDto,
    SupplyPositionSummary,
    BorrowPositionSummary,
} from "./dto/analytics.dto";

@Injectable()
export class AnalyticsService {
    constructor(
        @InjectRepository(Portfolio)
        private readonly portfolioRepository: Repository<Portfolio>,
        @InjectRepository(LendPosition)
        private readonly lendPositionRepository: Repository<LendPosition>,
        @InjectRepository(BorrowPosition)
        private readonly borrowPositionRepository: Repository<BorrowPosition>,
    ) { }

    async getTotalBalancePortfolio(
        accountId: string,
    ): Promise<TotalBalancePortfolioDto> {
        const lendPositions = await this.lendPositionRepository.find({
            where: { accountId },
        });

        const borrowPositions = await this.borrowPositionRepository.find({
            where: { accountId },
        });

        const totalSupply = lendPositions.reduce(
            (sum, pos) => sum + Number.parseFloat(pos.amount),
            0,
        );

        const totalBorrow = borrowPositions.reduce(
            (sum, pos) => sum + Number.parseFloat(pos.debt),
            0,
        );

        const netBalance = totalSupply - totalBorrow;

        const supplyPositions: SupplyPositionSummary[] = lendPositions.map(
            (pos) => ({
                assetId: pos.assetId,
                marketId: pos.marketId,
                amount: pos.amount,
                shares: pos.shares,
            }),
        );

        const borrowPositionSummaries: BorrowPositionSummary[] =
            borrowPositions.map((pos) => ({
                assetId: pos.assetId,
                marketId: pos.marketId,
                debt: pos.debt,
                shares: pos.shares,
            }));

        return {
            totalSupply: totalSupply.toString(),
            totalBorrow: totalBorrow.toString(),
            netBalance: netBalance.toString(),
            supplyPositions,
            borrowPositions: borrowPositionSummaries,
        };
    }

    async getMyAssets(accountId: string): Promise<MyAssetDto[]> {
        const portfolios = await this.portfolioRepository.find({
            where: { accountId },
        });

        return portfolios.map((portfolio) => ({
            assetId: portfolio.assetId,
            amount: portfolio.amount,
            isCollateral: portfolio.isCollateral,
        }));
    }

    async getAllMyPositions(accountId: string): Promise<MyPositionDto> {
        const lendPositions = await this.lendPositionRepository.find({
            where: { accountId },
        });

        const borrowPositions = await this.borrowPositionRepository.find({
            where: { accountId },
        });

        const lendPositionDtos: LendPositionDto[] = lendPositions.map(
            (pos) => ({
                id: pos.id,
                assetId: pos.assetId,
                marketId: pos.marketId,
                shares: pos.shares,
                amount: pos.amount,
                createdAt: pos.createdAt,
            }),
        );

        const borrowPositionDtos: BorrowPositionDto[] = borrowPositions.map(
            (pos) => ({
                id: pos.id,
                assetId: pos.assetId,
                marketId: pos.marketId,
                shares: pos.shares,
                debt: pos.debt,
                createdAt: pos.createdAt,
            }),
        );

        return {
            lendPositions: lendPositionDtos,
            borrowPositions: borrowPositionDtos,
        };
    }
}
