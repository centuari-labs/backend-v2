import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Market } from './entities/market.entity';
import { CreateMarketDto, MarketResponseDto, BorrowRateDto, NetAPRDto, ActiveLoanDto, TotalDepositDto, AssetDepositDto, CollateralFactorDto } from './dto/market.dto';
import { TokensService } from '../tokens/tokens.service';
import { Order } from '../orders/entities/order.entity';
import { OrderSide } from '../orders/constants/order.constants';
import { Portfolio } from '../analytics/entities/portfolio.entity';
import { BorrowPosition } from '../analytics/entities/borrow-position.entity';
import { Token } from '../tokens/entities/token.entity';

@Injectable()
export class MarketService {
    constructor(
        @InjectRepository(Market)
        private readonly marketRepository: Repository<Market>,
        @InjectRepository(Order)
        private readonly orderRepository: Repository<Order>,
        @InjectRepository(Portfolio)
        private readonly portfolioRepository: Repository<Portfolio>,
        @InjectRepository(BorrowPosition)
        private readonly borrowPositionRepository: Repository<BorrowPosition>,
        @InjectRepository(Token)
        private readonly tokenRepository: Repository<Token>,
        private readonly tokensService: TokensService,
    ) { }

    async getMarkets(assetId?: string): Promise<MarketResponseDto[]> {
        const queryBuilder = this.marketRepository
            .createQueryBuilder('market')
            .leftJoinAndSelect('market.asset', 'asset');

        if (assetId) {
            queryBuilder.where('market.assetId = :assetId', { assetId });
        }

        const markets = await queryBuilder.getMany();

        return markets.map(market => this.toResponseDto(market));
    }

    async createMarket(dto: CreateMarketDto): Promise<MarketResponseDto> {
        const market = this.marketRepository.create({
            id: crypto.randomUUID(),
            assetId: dto.assetId,
        });

        const savedMarket = await this.marketRepository.save(market);

        // Fetch with relations for response
        const marketWithAsset = await this.marketRepository.findOne({
            where: { id: savedMarket.id },
            relations: ['asset'],
        });

        if (!marketWithAsset) {
            throw new NotFoundException('Market not found after creation');
        }

        return this.toResponseDto(marketWithAsset);
    }

    private toResponseDto(market: Market): MarketResponseDto {
        return {
            id: market.id,
            assetId: market.assetId,
            createdAt: market.createdAt,
            asset: market.asset ? {
                id: market.asset.id,
                symbol: market.asset.symbol,
                name: market.asset.name,
                tokenAddress: market.asset.tokenAddress,
            } : undefined,
        };
    }

    async getBorrowRate(assetId?: string): Promise<BorrowRateDto> {
        const queryBuilder = this.orderRepository
            .createQueryBuilder('order')
            .where('order.side = :side', { side: OrderSide.Borrow })
            .orderBy('order.rate', 'DESC')
            .limit(1);

        if (assetId) {
            queryBuilder.andWhere('order.assetId = :assetId', { assetId });
        }

        const order = await queryBuilder.getOne();

        return {
            rate: order ? order.rate.toString() : '0',
            assetId: order?.assetId,
        };
    }

    async getNetAPR(assetId?: string): Promise<NetAPRDto> {
        const queryBuilder = this.orderRepository
            .createQueryBuilder('order')
            .where('order.side = :side', { side: OrderSide.Lend })
            .orderBy('order.rate', 'DESC')
            .limit(1);

        if (assetId) {
            queryBuilder.andWhere('order.assetId = :assetId', { assetId });
        }

        const order = await queryBuilder.getOne();

        return {
            rate: order ? order.rate.toString() : '0',
            assetId: order?.assetId,
        };
    }

    async getActiveLoans(accountId: string): Promise<ActiveLoanDto[]> {
        const borrowPositions = await this.borrowPositionRepository.find({
            where: { accountId },
        });

        return borrowPositions.map(position => ({
            id: position.id,
            assetId: position.assetId,
            marketId: position.marketId,
            shares: position.shares,
            debt: position.debt,
            originalDebt: position.originalDebt,
            createdAt: position.createdAt,
        }));
    }

    async getTotalDeposit(accountId: string): Promise<TotalDepositDto> {
        const portfolios = await this.portfolioRepository.find({
            where: { accountId },
        });

        const totalAmount = portfolios.reduce(
            (sum, portfolio) => sum + Number.parseFloat(portfolio.amount),
            0,
        );

        const assets: AssetDepositDto[] = portfolios.map(portfolio => ({
            assetId: portfolio.assetId,
            amount: portfolio.amount,
            isCollateral: portfolio.isCollateral,
        }));

        return {
            totalAmount: totalAmount.toString(),
            totalAmountUSD: '0',
            assets,
        };
    }

    async getCollateralFactor(): Promise<CollateralFactorDto> {
        const assets = await this.tokenRepository.find();

        if (assets.length === 0) {
            return {
                averageLLTV: '0',
                totalAssets: 0,
            };
        }

        const totalLLTV = assets.reduce(
            (sum, asset) => sum + Number.parseFloat((asset.averageLTV ?? 0).toString()),
            0,
        );

        const averageLLTV = totalLLTV / assets.length;

        return {
            averageLLTV: averageLLTV.toFixed(4),
            totalAssets: assets.length,
        };
    }
}
