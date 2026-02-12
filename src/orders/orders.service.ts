import {
    BadRequestException,
    ForbiddenException,
    HttpStatus,
    Injectable,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { NatsService } from "../core/nats/nats.service";
import { PriceService } from "../price/price.service";
import { TokensService } from "../tokens/tokens.service";
import { NATS_SUBJECTS } from "./constants/nats-subjects.constants";
import {
    OrderSide,
    OrderStatus,
    OrderType,
} from "./constants/order.constants";
import type { CreateBorrowLimitOrderDto } from "./dto/create-borrow-limit-order.dto";
import type { CreateBorrowMarketOrderDto } from "./dto/create-borrow-market-order.dto";
import type { CreateLendLimitOrderDto } from "./dto/create-lend-limit-order.dto";
import type { CreateLendMarketOrderDto } from "./dto/create-lend-market-order.dto";
import { OrderResponse } from "./dto/order-response.dto";
import { Order } from "./entities/order.entity";
import { toPercentage } from "../common/utils/number.utils";
import { OrderRepository } from "./repositories/order.repository";
import { humanToBaseUnits } from "../common/utils/number.utils";

@Injectable()
export class OrdersService {
    private readonly logger = new Logger(OrdersService.name);

    constructor(
        private readonly orderRepository: OrderRepository,
        private readonly tokensService: TokensService,
        private readonly natsService: NatsService,
    ) { }

    async getOrCreateAccount(walletAddress: string, privyUserId: string): Promise<string> {
        const account = await this.orderRepository.getOrCreateAccount(walletAddress, privyUserId);
        return account.id;
    }

    async createLendMarketOrder(
        dto: CreateLendMarketOrderDto,
        walletAddress: string,
        privyUserId: string,
    ): Promise<OrderResponse> {
        const accountId = await this.getOrCreateAccount(walletAddress, privyUserId);
        
        await this.tokensService.validateTokenByAssetId(dto.assetId);
        const decimals = await this.tokensService.getTokenDecimalsByAssetId(dto.assetId);
        const quantityBaseUnits = humanToBaseUnits(dto.amount, decimals!);

        const order = this.orderRepository.create({
            accountId,
            assetId: dto.assetId,
            side: OrderSide.Lend,
            type: OrderType.Market,
            quantity: quantityBaseUnits,
            settlementFee: "0",
            status: OrderStatus.Open,
            rate: 0,
            autoRollover: dto.autoRollover ?? false,
        });

        const savedOrder = await this.orderRepository.save(order);

        await this.publishOrderToNats(NATS_SUBJECTS.LEND_MARKET, savedOrder);

        return this.mapToResponse(savedOrder, dto, walletAddress);
    }

    async createLendLimitOrder(
        dto: CreateLendLimitOrderDto,
        walletAddress: string,
        privyUserId: string,
    ): Promise<OrderResponse> {
        const accountId = await this.getOrCreateAccount(walletAddress, privyUserId);
        
        await this.tokensService.validateTokenByAssetId(dto.assetId);
        const decimals = await this.tokensService.getTokenDecimalsByAssetId(dto.assetId);
        const quantityBaseUnits = humanToBaseUnits(dto.amount, decimals!);

        //@todo : calculate settlement fee amount
        const order = this.orderRepository.create({
            accountId,
            assetId: dto.assetId,
            side: OrderSide.Lend,
            type: OrderType.Limit,
            quantity: quantityBaseUnits,
            settlementFee: "0",
            rate: dto.rate,
            status: OrderStatus.Open,
            autoRollover: dto.autoRollover ?? false,
        });

        const savedOrder = await this.orderRepository.save(order);

        await this.publishOrderToNats(NATS_SUBJECTS.LEND_LIMIT, savedOrder);

        return this.mapToResponse(savedOrder, dto, walletAddress);
    }

    async createBorrowMarketOrder(
        dto: CreateBorrowMarketOrderDto,
        walletAddress: string,
        privyUserId: string,
    ): Promise<OrderResponse> {
        const accountId = await this.getOrCreateAccount(walletAddress, privyUserId);
        await this.tokensService.validateTokenByAssetId(dto.assetId);

        const decimals = await this.tokensService.getTokenDecimalsByAssetId(dto.assetId);
        const quantityBaseUnits = humanToBaseUnits(dto.amount, decimals!);

        //@todo : validate health factor

        const order = this.orderRepository.create({
            accountId,
            assetId: dto.assetId,
            side: OrderSide.Borrow,
            type: OrderType.Market,
            quantity: quantityBaseUnits,
            settlementFee: "0",
            status: OrderStatus.Open,
            rate: 0,
            autoRollover: dto.autoRollover ?? false,
        });

        const savedOrder = await this.orderRepository.save(order);

        await this.publishOrderToNats(NATS_SUBJECTS.BORROW_MARKET, savedOrder);

        return this.mapToResponse(savedOrder, dto, walletAddress);
    }

    async createBorrowLimitOrder(
        dto: CreateBorrowLimitOrderDto,
        walletAddress: string,
        privyUserId: string,
    ): Promise<OrderResponse> {
        const accountId = await this.getOrCreateAccount(walletAddress, privyUserId);
        await this.tokensService.validateTokenByAssetId(dto.assetId);

        const decimals = await this.tokensService.getTokenDecimalsByAssetId(dto.assetId);
        const quantityBaseUnits = humanToBaseUnits(dto.amount, decimals!);

        //@todo : validate health factor

        const order = this.orderRepository.create({
            accountId,
            assetId: dto.assetId,
            side: OrderSide.Borrow,
            type: OrderType.Limit,
            quantity: quantityBaseUnits,
            settlementFee: "0",
            rate: dto.rate,
            status: OrderStatus.Open,
            autoRollover: dto.autoRollover ?? false,
        });

        const savedOrder = await this.orderRepository.save(order);

        await this.publishOrderToNats(NATS_SUBJECTS.BORROW_LIMIT, savedOrder);

        return this.mapToResponse(savedOrder, dto, walletAddress);
    }

    async cancelOrder(orderId: string, walletAddress: string): Promise<Order> {
        // Find the order
        const orders = await this.orderRepository.getOpenOrders(orderId);

        if (!orders.length) {
            throw new NotFoundException(`Order with ID ${orderId} not found`);
        }

        const account = await this.orderRepository.findAccountByWallet(walletAddress);

        if (!account) {
            throw new ForbiddenException("Account not found for this wallet");
        }

        const accountId = account.id;

        if (orders[0].accountId !== accountId) {
            throw new ForbiddenException("You do not own this order");
        }

        const cancellableStatuses = [
            OrderStatus.Open,
            OrderStatus.PartiallyFilled,
        ] as OrderStatus[];

        if (!cancellableStatuses.includes(orders[0].status)) {
            throw new BadRequestException(
                "Order can only be cancelled when status is open or partial",
            );
        }

        orders[0].status = OrderStatus.Cancelled;

        const updatedOrder = await this.orderRepository.save(orders[0]);

        // Publish cancellation event to NATS
        await this.publishCancelOrderToNats(orderId, walletAddress);

        return updatedOrder;
    }

    private mapToResponse(
        order: Order,
        dto: CreateLendMarketOrderDto | CreateLendLimitOrderDto | CreateBorrowMarketOrderDto | CreateBorrowLimitOrderDto,
        walletAddress: string,
    ): OrderResponse {
        return {
            statusCode: HttpStatus.CREATED,
            data: {
                orderId: order.id,
                walletAddress: walletAddress,
                assetId: dto.assetId,
                maturities: dto.maturities,
                timestamp: new Date(order.createdAt).getTime(),
                side: order.side,
                type: order.type,
                status: order.status,
                originalAmount: dto.amount,
                settlementFeeAmount: order.settlementFee,
                // order.rate is stored as basis points in the DB; expose percentage in responses
                rate: toPercentage(order.rate),
                autoRollover: order.autoRollover,
                createdAt: order.createdAt,
                updatedAt: order.updatedAt,
            },
        };
    }

    private async publishOrderToNats(
        subject: string,
        order: Order,
    ): Promise<void> {
        try {
            await this.natsService.publish(subject, {
                event: subject,
                timestamp: new Date().toISOString(),
                data: order,
            });
            this.logger.debug(`Published order ${order.id} to ${subject}`);
        } catch (error) {
            this.logger.error(
                `Failed to publish order ${order.id} to NATS: ${error.message}`,
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
                event: subject,
                timestamp: new Date().toISOString(),
                data: {
                    orderId,
                    walletAddress,
                },
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
