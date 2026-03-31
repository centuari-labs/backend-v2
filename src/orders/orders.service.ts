import {
    BadRequestException,
    ForbiddenException,
    HttpStatus,
    Injectable,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { NatsService } from "../core/nats/nats.service";
import { MarketRepositories } from "../market/repository/market.repository";
import { PriceService } from "../price/price.service";
import { TokensService } from "../tokens/tokens.service";
import { NATS_SUBJECTS } from "./constants/nats-subjects.constants";
import {
    CancelReason,
    OrderSide,
    OrderStatus,
    OrderType,
    SETTLEMENT_FEE_MAX_CAP_USD,
    SETTLEMENT_FEE_RATE_BPS,
    MAKER_FEE_RATE_BPS,
    TAKER_FEE_RATE_BPS,
} from "./constants/order.constants";
import { DataSource } from "typeorm";
import type {
    BaseCreateOrderDto,
    CreateLimitOrderDto,
    CreateMarketOrderDto,
} from "./dto/create-order.dto";
import { OrderResponse } from "./dto/order-response.dto";
import { Order } from "./entities/order.entity";
import {
    toPercentage,
    humanToBaseUnits,
    baseUnitsToHuman,
    calculateSettlementFee,
    calculateTradeFee,
} from "../common/utils/number.utils";
import { OrderRepository } from "./repositories/order.repository";
import { PortfolioService } from "../portfolio/portfolio.service";
import { HEALTH_FACTOR_NO_DEBT } from "../portfolio/helpers/health-factor.helpers";
import {
    orderSchema,
    MatchingEngineOrder,
} from "./matching-engine/order.schema";
import { UpdateOrderDto } from "./dto/update-order.dto";
import { OrderMarket } from "./entities/order-market.entity";

const MIN_HEALTH_FACTOR = 1;

interface PreparedOrderContext {
    accountId: string;
    decimals: number;
    quantityBaseUnits: string;
    settlementFeeBaseUnits: string;
    estimatedTradeFeeBaseUnits: string;
}

@Injectable()
export class OrdersService {
    private readonly logger = new Logger(OrdersService.name);

    constructor(
        private readonly orderRepository: OrderRepository,
        private readonly tokensService: TokensService,
        private readonly natsService: NatsService,
        private readonly priceService: PriceService,
        private readonly marketRepository: MarketRepositories,
        private readonly portfolioService: PortfolioService,
        private readonly dataSource: DataSource,
    ) { }

    async getOrCreateAccount(
        walletAddress: string,
        privyUserId: string,
    ): Promise<string> {
        const account = await this.orderRepository.getOrCreateAccount(
            walletAddress,
            privyUserId,
        );
        return account.id;
    }

    async createLendMarketOrder(
        dto: CreateMarketOrderDto,
        walletAddress: string,
        privyUserId: string,
    ): Promise<OrderResponse> {
        const ctx = await this.prepareOrder(
            dto,
            OrderType.Market,
            walletAddress,
            privyUserId,
        );
        await this.portfolioService.checkAvailableBalanceForLend(
            ctx.accountId,
            dto.assetId,
            ctx.quantityBaseUnits,
            ctx.settlementFeeBaseUnits,
            ctx.estimatedTradeFeeBaseUnits,
        );
        await this.checkCounterpartyExists(
            dto.assetId,
            OrderSide.Lend,
            dto.marketIds ?? [],
            ctx.accountId,
        );
        return this.finalizeOrder(
            ctx,
            dto,
            { side: OrderSide.Lend, type: OrderType.Market, rate: 0 },
            walletAddress,
            NATS_SUBJECTS.LEND_MARKET,
        );
    }

    async createLendLimitOrder(
        dto: CreateLimitOrderDto,
        walletAddress: string,
        privyUserId: string,
    ): Promise<OrderResponse> {
        const ctx = await this.prepareOrder(
            dto,
            OrderType.Limit,
            walletAddress,
            privyUserId,
        );
        await this.portfolioService.checkAvailableBalanceForLend(
            ctx.accountId,
            dto.assetId,
            ctx.quantityBaseUnits,
            ctx.settlementFeeBaseUnits,
            ctx.estimatedTradeFeeBaseUnits,
        );
        return this.finalizeOrder(
            ctx,
            dto,
            {
                side: OrderSide.Lend,
                type: OrderType.Limit,
                rate: dto.rate,
            },
            walletAddress,
            NATS_SUBJECTS.LEND_LIMIT,
        );
    }

    async createBorrowMarketOrder(
        dto: CreateMarketOrderDto,
        walletAddress: string,
        privyUserId: string,
    ): Promise<OrderResponse> {
        const ctx = await this.prepareOrder(
            dto,
            OrderType.Market,
            walletAddress,
            privyUserId,
        );
        await this.portfolioService.checkAvailableBalanceForBorrowFees(
            ctx.accountId,
            dto.assetId,
            ctx.settlementFeeBaseUnits,
            ctx.estimatedTradeFeeBaseUnits,
        );
        await this.checkCounterpartyExists(
            dto.assetId,
            OrderSide.Borrow,
            dto.marketIds ?? [],
            ctx.accountId,
        );
        await this.validateHealthFactor(ctx.accountId, dto);
        return this.finalizeOrder(
            ctx,
            dto,
            { side: OrderSide.Borrow, type: OrderType.Market, rate: 0 },
            walletAddress,
            NATS_SUBJECTS.BORROW_MARKET,
        );
    }

    async createBorrowLimitOrder(
        dto: CreateLimitOrderDto,
        walletAddress: string,
        privyUserId: string,
    ): Promise<OrderResponse> {
        const ctx = await this.prepareOrder(
            dto,
            OrderType.Limit,
            walletAddress,
            privyUserId,
        );
        await this.portfolioService.checkAvailableBalanceForBorrowFees(
            ctx.accountId,
            dto.assetId,
            ctx.settlementFeeBaseUnits,
            ctx.estimatedTradeFeeBaseUnits,
        );
        await this.validateHealthFactor(ctx.accountId, dto);
        return this.finalizeOrder(
            ctx,
            dto,
            {
                side: OrderSide.Borrow,
                type: OrderType.Limit,
                rate: dto.rate,
            },
            walletAddress,
            NATS_SUBJECTS.BORROW_LIMIT,
        );
    }

    async cancelOrder(orderId: string, walletAddress: string): Promise<Order> {
        const order = await this.orderRepository.getOrderById(orderId);

        if (!order) {
            throw new NotFoundException(`Order with ID ${orderId} not found`);
        }

        const account =
            await this.orderRepository.findAccountByWallet(walletAddress);

        if (!account || order.accountId !== account.id) {
            throw new ForbiddenException("You do not own this order");
        }

        const cancellableStatuses = [
            OrderStatus.Open,
            OrderStatus.PartiallyFilled,
        ] as OrderStatus[];

        if (!cancellableStatuses.includes(order.status)) {
            throw new BadRequestException(
                "Order can only be cancelled when status is open or partial",
            );
        }

        order.status = OrderStatus.Cancelled;
        order.cancelReason = CancelReason.UserCancelled;

        const updatedOrder = await this.orderRepository.save(order);

        // Publish cancellation event to NATS
        await this.publishCancelOrderToNats(orderId, walletAddress);

        return updatedOrder;
    }


    async updateOrder(
        orderId: string,
        walletAddress: string,
        dto: UpdateOrderDto,
    ): Promise<Order> {
        return this.dataSource.transaction(async (manager) => {
            const orderRepo = manager.getRepository(Order);
            const orderMarketRepo = manager.getRepository(OrderMarket);

            const order = await orderRepo.findOne({ where: { id: orderId } });
            if (!order) {
                throw new NotFoundException(`Order with ID ${orderId} not found`);
            }

            const account = await this.orderRepository.findAccountByWallet(walletAddress);
            if (!account || order.accountId !== account.id) {
                throw new ForbiddenException("You do not own this order");
            }

            if (
                order.status !== OrderStatus.Open &&
                order.status !== OrderStatus.PartiallyFilled
            ) {
                throw new BadRequestException(
                    "Order can only be updated when status is open or partially filled",
                );
            }

            const decimals = await this.tokensService.getTokenDecimalsByAssetId(order.assetId);
            if (decimals == null) {
                throw new BadRequestException("Token decimals not configured");
            }

            const newQuantityBaseUnits = humanToBaseUnits(dto.amount, decimals);
            const filledQty = BigInt(order.filledQuantity);

            if (BigInt(newQuantityBaseUnits) <= filledQty) {
                throw new BadRequestException(
                    "New quantity must be greater than the already filled quantity",
                );
            }

            const settlementFee = await this.computeSettlementFee(
                order.assetId,
                dto.amount,
                decimals,
            );

            if (order.side === OrderSide.Borrow) {
                const assetPrice = await this.priceService.getPrice(order.assetId);
                if (assetPrice == null || assetPrice <= 0) {
                    throw new BadRequestException("Price not available for this asset");
                }
                const newOrderUsd = Number(dto.amount) * assetPrice;

                const hfResult = await this.portfolioService.getHealthFactorForAccount(
                    order.accountId,
                    {
                        additionalBorrowUsd: newOrderUsd,
                        includeOpenOrders: true,
                    },
                );

                if (
                    hfResult.healthFactor !== HEALTH_FACTOR_NO_DEBT &&
                    Number.isFinite(hfResult.healthFactor) &&
                    hfResult.healthFactor < MIN_HEALTH_FACTOR
                ) {
                    throw new BadRequestException(
                        "Update would reduce health factor below 1",
                    );
                }
            }

            order.quantity = newQuantityBaseUnits;
            order.settlementFee = settlementFee;
            order.rate = dto.rate;
            order.autoRollover = dto.autoRollover ?? order.autoRollover;
            order.status = filledQty > 0n ? OrderStatus.PartiallyFilled : OrderStatus.Open;

            const updatedOrder = await orderRepo.save(order);

            await orderMarketRepo.delete({ orderId });
            for (const marketId of dto.marketIds) {
                await orderMarketRepo.save({
                    orderId: updatedOrder.id,
                    marketId,
                });
            }

            const engineOrder = await this.buildMatchingEngineOrder(
                updatedOrder,
                { marketIds: dto.marketIds },
                walletAddress,
            );
            await this.natsService.publish(NATS_SUBJECTS.UPDATE, engineOrder);

            return updatedOrder;
        });
    }

    private async prepareOrder(
        dto: { assetId: string; amount: string },
        orderType: OrderType,
        walletAddress: string,
        privyUserId: string,
    ): Promise<PreparedOrderContext> {
        const accountId = await this.getOrCreateAccount(
            walletAddress,
            privyUserId,
        );
        await this.tokensService.validateTokenByAssetId(dto.assetId);
        const decimals = await this.tokensService.getTokenDecimalsByAssetId(
            dto.assetId,
        );
        if (decimals == null) {
            throw new BadRequestException("Token decimals not configured");
        }
        const quantityBaseUnits = humanToBaseUnits(dto.amount, decimals);
        const settlementFeeBaseUnits = await this.computeSettlementFee(
            dto.assetId,
            dto.amount,
            decimals,
        );
        const estimatedTradeFeeBaseUnits = this.computeEstimatedTradeFee(
            dto.amount,
            decimals,
            orderType,
        );
        return {
            accountId,
            decimals,
            quantityBaseUnits,
            settlementFeeBaseUnits,
            estimatedTradeFeeBaseUnits,
        };
    }

    private async checkCounterpartyExists(
        assetId: string,
        side: OrderSide,
        marketIds: string[],
        accountId: string,
    ): Promise<void> {
        const hasCounterparty =
            await this.orderRepository.hasCounterpartyOrders(
                assetId,
                side,
                marketIds,
                accountId,
            );
        if (!hasCounterparty) {
            throw new BadRequestException(
                "No available liquidity for this market order",
            );
        }
    }

    private async validateHealthFactor(
        accountId: string,
        dto: { assetId: string; amount: string },
    ): Promise<void> {
        const assetPrice = await this.priceService.getPrice(dto.assetId);
        if (assetPrice == null || assetPrice <= 0) {
            throw new BadRequestException("Price not available for this asset");
        }
        const newOrderUsd = Number(dto.amount) * assetPrice;
        const hfResult = await this.portfolioService.getHealthFactorForAccount(
            accountId,
            {
                additionalBorrowUsd: newOrderUsd,
                includeOpenOrders: true,
            },
        );
        if (
            hfResult.healthFactor !== HEALTH_FACTOR_NO_DEBT &&
            Number.isFinite(hfResult.healthFactor) &&
            hfResult.healthFactor < MIN_HEALTH_FACTOR
        ) {
            throw new BadRequestException(
                "Borrow would reduce health factor below 1 (considering open orders); position not allowed.",
            );
        }
    }

    private async finalizeOrder(
        ctx: PreparedOrderContext,
        dto: BaseCreateOrderDto,
        orderParams: {
            side: OrderSide;
            type: OrderType;
            rate: number;
        },
        walletAddress: string,
        natsSubject: string,
    ): Promise<OrderResponse> {
        const order = this.orderRepository.create({
            accountId: ctx.accountId,
            assetId: dto.assetId,
            side: orderParams.side,
            type: orderParams.type,
            quantity: ctx.quantityBaseUnits,
            settlementFee: ctx.settlementFeeBaseUnits,
            status: OrderStatus.Open,
            rate: orderParams.rate,
            autoRollover: dto.autoRollover ?? false,
        });

        const savedOrder = await this.orderRepository.saveOrderWithMarkets(
            order,
            dto.marketIds ?? [],
        );

        const engineOrder = await this.buildMatchingEngineOrder(
            savedOrder,
            dto,
            walletAddress,
        );
        await this.publishOrderToNats(natsSubject, engineOrder, ctx.accountId);

        return this.mapToResponse(
            savedOrder,
            dto,
            walletAddress,
            ctx.estimatedTradeFeeBaseUnits,
        );
    }

    private async resolveMarketMaturities(
        marketIds: string[],
    ): Promise<Map<string, number>> {
        const marketEntities =
            await this.marketRepository.getMarketsByIds(marketIds);
        const maturityByMarketId = new Map<string, number>();
        for (const market of marketEntities) {
            const maturityUnix = market.maturity
                ? Math.floor(market.maturity.getTime() / 1000)
                : 0;
            maturityByMarketId.set(market.id, maturityUnix);
        }
        return maturityByMarketId;
    }

    private async computeSettlementFee(
        assetId: string,
        amountHuman: string,
        decimals: number,
    ): Promise<string> {
        const price = await this.priceService.getPrice(assetId);
        if (price == null || price <= 0) {
            throw new BadRequestException("Price not available for this asset");
        }

        const amountNum = Number.parseFloat(amountHuman);
        if (!Number.isFinite(amountNum) || amountNum <= 0) {
            return "0";
        }

        const feeHuman = calculateSettlementFee(
            amountNum,
            price,
            SETTLEMENT_FEE_RATE_BPS,
            SETTLEMENT_FEE_MAX_CAP_USD,
        );
        if (feeHuman === 0) return "0";
        // Truncate fee to token's decimal precision to avoid "Too many decimal places"
        const feeTruncated =
            decimals > 0
                ? Number(feeHuman.toFixed(decimals))
                : Math.floor(feeHuman);
        if (feeTruncated === 0) return "0";
        return humanToBaseUnits(feeTruncated.toString(), decimals);
    }

    private computeEstimatedTradeFee(
        amountHuman: string,
        decimals: number,
        orderType: OrderType,
    ): string {
        const amountNum = Number.parseFloat(amountHuman);
        if (!Number.isFinite(amountNum) || amountNum <= 0) {
            return "0";
        }

        const feeBps =
            orderType === OrderType.Limit
                ? MAKER_FEE_RATE_BPS
                : TAKER_FEE_RATE_BPS;
        const feeHuman = calculateTradeFee(amountNum, feeBps);
        if (feeHuman === 0) return "0";

        const feeTruncated =
            decimals > 0
                ? Number(feeHuman.toFixed(decimals))
                : Math.floor(feeHuman);
        if (feeTruncated === 0) return "0";
        return humanToBaseUnits(feeTruncated.toString(), decimals);
    }

    private async mapToResponse(
        order: Order,
        dto: BaseCreateOrderDto,
        walletAddress: string,
        estimatedTradeFeeBaseUnits = "0",
    ): Promise<OrderResponse> {
        const maturityByMarketId = await this.resolveMarketMaturities(
            dto.marketIds ?? [],
        );
        const markets = (dto.marketIds ?? []).map((marketId) => ({
            marketId,
            maturity: maturityByMarketId.get(marketId) ?? 0,
        }));

        const decimals = await this.tokensService.getTokenDecimalsByAssetId(
            dto.assetId,
        );

        return {
            statusCode: HttpStatus.CREATED,
            data: {
                orderId: order.id,
                walletAddress: walletAddress,
                assetId: dto.assetId,
                markets,
                timestamp: new Date(order.createdAt).getTime(),
                side: order.side,
                type: order.type,
                status: order.status,
                originalAmount: dto.amount,
                settlementFeeAmount: baseUnitsToHuman(
                    order.settlementFee,
                    decimals!,
                ),
                estimatedTradeFeeAmount: baseUnitsToHuman(
                    estimatedTradeFeeBaseUnits,
                    decimals!,
                ),
                // order.rate is stored as basis points in the DB; expose percentage in responses
                rate: toPercentage(order.rate),
                autoRollover: order.autoRollover,
                createdAt: order.createdAt,
                updatedAt: order.updatedAt,
            },
        };
    }

    private async buildMatchingEngineOrder(
        order: Order,
        dto: { marketIds: string[] },
        walletAddress: string,
    ): Promise<MatchingEngineOrder> {
        const token = await this.tokensService.getTokenByAssetId(order.assetId);
        const loanToken = token.tokenAddress;

        const maturityByMarketId = await this.resolveMarketMaturities(
            dto.marketIds ?? [],
        );
        const markets = (dto.marketIds ?? []).map((marketId) => ({
            marketId,
            maturity: maturityByMarketId.get(marketId) ?? 0,
        }));

        const quantity = BigInt(order.quantity);
        const filledQuantity = BigInt(order.filledQuantity);
        const remaining = quantity - filledQuantity;

        const basePayload: any = {
            orderId: order.id,
            walletAddress,
            loanToken,
            assetId: order.assetId,
            markets,
            timestamp: new Date(order.createdAt).getTime(),
            side: order.side,
            type: order.type,
            status: order.status,
            originalAmount: order.quantity,
            remainingAmount: remaining >= 0n ? remaining.toString() : "0",
            settlementFeeAmount: order.settlementFee,
            remainingSettlementFeeAmount: order.settlementFee,
        };

        if (order.type === OrderType.Limit) {
            basePayload.rate = Number(order.rate);
        }

        const parsed = orderSchema.parse(basePayload);
        return parsed;
    }

    private async publishOrderToNats(
        subject: string,
        order: MatchingEngineOrder,
        _accountId: string,
    ): Promise<void> {
        try {
            await this.natsService.publish(subject, order);
            this.logger.debug(
                `Published order ${order.orderId as string} to ${subject}`,
            );
        } catch (error) {
            this.logger.error(
                `Failed to publish order ${order.orderId as string} to NATS: ${error.message}`,
            );
        }
    }

    private async publishCancelOrderToNats(
        orderId: string,
        walletAddress: string,
    ): Promise<void> {
        const subject = NATS_SUBJECTS.CANCEL;
        try {
            await this.natsService.publish(subject, {
                orderId,
                walletAddress,
            });
            this.logger.debug(
                `Published cancel order ${orderId} to ${subject}`,
            );
        } catch (error) {
            this.logger.error(
                `Failed to publish cancel order ${orderId} to NATS: ${error.message}`,
            );
        }
    }
}