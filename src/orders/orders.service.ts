import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
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
import { Order } from "./entities/order.entity";
import { OrderRepository } from "./repositories/order.repository";

@Injectable()
export class OrdersService {
    private readonly logger = new Logger(OrdersService.name);

    constructor(
        private readonly orderRepository: OrderRepository,
        private readonly priceService: PriceService,
        private readonly tokensService: TokensService,
        private readonly natsService: NatsService,
    ) { }

    //@todo : need to make sure to convert to token decimals
    /**
     * Get the current USD price for a token by address.
     * Uses the in-memory price cache (populated by interval worker).
     */
    async getTokenPriceInUsd(tokenAddress: string): Promise<number | null> {
        return this.priceService.getPrice(tokenAddress);
    }

    async getOrCreateAccount(walletAddress: string, privyUserId: string): Promise<string> {
        const account = await this.orderRepository.getOrCreateAccount(walletAddress, privyUserId);
        return account.id;
    }

    async getAssetId(tokenAddress: string): Promise<string> {
        const assetId = await this.orderRepository.getAssetId(tokenAddress);
        if (!assetId) {
            throw new NotFoundException(`Asset for token ${tokenAddress} not found`);
        }
        return assetId.id;
    }

    async createLendMarketOrder(
        dto: CreateLendMarketOrderDto,
        walletAddress: string,
        privyUserId: string,
    ): Promise<Order> {
        // Validate loan token exists
        await this.tokensService.validateToken(dto.loanToken);
        const accountId = await this.getOrCreateAccount(walletAddress, privyUserId);
        const assetId = await this.getAssetId(dto.loanToken);

        const order = this.orderRepository.create({
            accountId,
            assetId,
            side: OrderSide.Lend,
            type: OrderType.Market,
            quantity: dto.amount,
            settlementFee: "0",
            status: OrderStatus.Open,
            rate: 0,
        });

        const savedOrder = await this.orderRepository.save(order);

        await this.publishOrderToNats(NATS_SUBJECTS.LEND_MARKET, savedOrder);

        return savedOrder;
    }

    async createLendLimitOrder(
        dto: CreateLendLimitOrderDto,
        walletAddress: string,
        privyUserId: string,
    ): Promise<Order> {
        // Validate loan token exists
        await this.tokensService.validateToken(dto.loanToken);
        const accountId = await this.getOrCreateAccount(walletAddress, privyUserId);
        const assetId = await this.getAssetId(dto.loanToken);

        //@todo : calculate settlement fee amount
        //@todo : calculate for token decimals
        const order = this.orderRepository.create({
            accountId,
            assetId,
            side: OrderSide.Lend,
            type: OrderType.Limit,
            quantity: dto.amount,
            settlementFee: "0",
            rate: dto.rate,
            status: OrderStatus.Open,
        });

        const savedOrder = await this.orderRepository.save(order);

        await this.publishOrderToNats(NATS_SUBJECTS.LEND_LIMIT, savedOrder);

        return savedOrder;
    }

    async createBorrowMarketOrder(
        dto: CreateBorrowMarketOrderDto,
        walletAddress: string,
        privyUserId: string,
    ): Promise<Order> {
        // Validate loan token exists
        await this.tokensService.validateToken(dto.loanToken);
        const accountId = await this.getOrCreateAccount(walletAddress, privyUserId);
        const assetId = await this.getAssetId(dto.loanToken);

        const order = this.orderRepository.create({
            accountId,
            assetId,
            side: OrderSide.Borrow,
            type: OrderType.Market,
            quantity: dto.amount,
            settlementFee: "0",
            status: OrderStatus.Open,
            rate: 0,
        });

        const savedOrder = await this.orderRepository.save(order);

        await this.publishOrderToNats(NATS_SUBJECTS.BORROW_MARKET, savedOrder);

        return savedOrder;
    }

    async createBorrowLimitOrder(
        dto: CreateBorrowLimitOrderDto,
        walletAddress: string,
        privyUserId: string,
    ): Promise<Order> {
        // Validate loan token exists
        await this.tokensService.validateToken(dto.loanToken);
        const accountId = await this.getOrCreateAccount(walletAddress, privyUserId);
        const assetId = await this.getAssetId(dto.loanToken);

        const order = this.orderRepository.create({
            accountId,
            assetId,
            side: OrderSide.Borrow,
            type: OrderType.Limit,
            quantity: dto.amount,
            settlementFee: "0",
            rate: dto.rate,
            status: OrderStatus.Open,
        });

        const savedOrder = await this.orderRepository.save(order);

        await this.publishOrderToNats(NATS_SUBJECTS.BORROW_LIMIT, savedOrder);

        return savedOrder;
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
