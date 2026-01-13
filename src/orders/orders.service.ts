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
import { TokensService } from "../tokens/tokens.service";
import { NATS_SUBJECTS } from "./constants/nats-subjects.constants";
import {
    OrderSide,
    OrderStatus,
    OrderType,
} from "./constants/order.constants";
import { order_history_reasons } from "./constants/order-history.constants";
import type { CreateBorrowLimitOrderDto } from "./dto/create-borrow-limit-order.dto";
import type { CreateBorrowMarketOrderDto } from "./dto/create-borrow-market-order.dto";
import type { CreateLendLimitOrderDto } from "./dto/create-lend-limit-order.dto";
import type { CreateLendMarketOrderDto } from "./dto/create-lend-market-order.dto";
import { Order } from "./entities/order.entity";
import { OrderHistory } from "./entities/order-history.entity";

@Injectable()
export class OrdersService {
    private readonly logger = new Logger(OrdersService.name);

    constructor(
        @InjectRepository(Order)
        private readonly orderRepository: Repository<Order>,
        @InjectRepository(OrderHistory)
        private readonly orderHistoryRepository: Repository<OrderHistory>,
        private readonly tokensService: TokensService,
        private readonly natsService: NatsService,
    ) {}

    async createLendMarketOrder(
        dto: CreateLendMarketOrderDto,
        walletAddress: string,
    ): Promise<Order> {
        // Validate loan token exists
        await this.tokensService.validateToken(dto.loanToken);

        const order = this.orderRepository.create({
            walletAddress,
            side: OrderSide.Lend,
            type: OrderType.Market,
            loanToken: dto.loanToken,
            originalAmount: dto.amount,
            remainingAmount: dto.amount,
            settlementFeeAmount: "0",
            status: OrderStatus.Open,
            maturities: dto.maturities,
            timestamp: Date.now(),
            rate: null, // Market order has no rate initially
        });

        const savedOrder = await this.orderRepository.save(order);

        await this.createOrderHistoryEntry(
            savedOrder.orderId,
            null,
            OrderStatus.Open,
            null,
            savedOrder.remainingAmount,
            order_history_reasons.order_created,
        );

        await this.publishOrderToNats(NATS_SUBJECTS.LEND_MARKET, savedOrder);

        return savedOrder;
    }

    async createLendLimitOrder(
        dto: CreateLendLimitOrderDto,
        walletAddress: string,
    ): Promise<Order> {
        // Validate loan token exists
        await this.tokensService.validateToken(dto.loanToken);

        const order = this.orderRepository.create({
            walletAddress,
            side: OrderSide.Lend,
            type: OrderType.Limit,
            loanToken: dto.loanToken,
            originalAmount: dto.amount,
            remainingAmount: dto.amount,
            settlementFeeAmount: "0",
            rate: dto.rate,
            status: OrderStatus.Open,
            maturities: dto.maturities,
            timestamp: Date.now(),
        });

        const savedOrder = await this.orderRepository.save(order);

        await this.createOrderHistoryEntry(
            savedOrder.orderId,
            null,
            OrderStatus.Open,
            null,
            savedOrder.remainingAmount,
            order_history_reasons.order_created,
        );

        await this.publishOrderToNats(NATS_SUBJECTS.LEND_LIMIT, savedOrder);

        return savedOrder;
    }

    async createBorrowMarketOrder(
        dto: CreateBorrowMarketOrderDto,
        walletAddress: string,
    ): Promise<Order> {
        // Validate loan token exists
        await this.tokensService.validateToken(dto.loanToken);

        const order = this.orderRepository.create({
            walletAddress,
            side: OrderSide.Borrow,
            type: OrderType.Market,
            loanToken: dto.loanToken,
            originalAmount: dto.amount,
            remainingAmount: dto.amount,
            settlementFeeAmount: "0",
            status: OrderStatus.Open,
            maturities: dto.maturities,
            timestamp: Date.now(),
            rate: null,
        });

        const savedOrder = await this.orderRepository.save(order);

        await this.createOrderHistoryEntry(
            savedOrder.orderId,
            null,
            OrderStatus.Open,
            null,
            savedOrder.remainingAmount,
            order_history_reasons.order_created,
        );

        await this.publishOrderToNats(NATS_SUBJECTS.BORROW_MARKET, savedOrder);

        return savedOrder;
    }

    async createBorrowLimitOrder(
        dto: CreateBorrowLimitOrderDto,
        walletAddress: string,
    ): Promise<Order> {
        // Validate loan token exists
        await this.tokensService.validateToken(dto.loanToken);

        const order = this.orderRepository.create({
            walletAddress,
            side: OrderSide.Borrow,
            type: OrderType.Limit,
            loanToken: dto.loanToken,
            originalAmount: dto.amount,
            remainingAmount: dto.amount,
            settlementFeeAmount: "0",
            rate: dto.rate,
            status: OrderStatus.Open,
            maturities: dto.maturities,
            timestamp: Date.now(),
        });

        const savedOrder = await this.orderRepository.save(order);

        await this.createOrderHistoryEntry(
            savedOrder.orderId,
            null,
            OrderStatus.Open,
            null,
            savedOrder.remainingAmount,
            order_history_reasons.order_created,
        );

        await this.publishOrderToNats(NATS_SUBJECTS.BORROW_LIMIT, savedOrder);

        return savedOrder;
    }

    async cancelOrder(orderId: string, walletAddress: string): Promise<Order> {
        // Find the order
        const order = await this.orderRepository.findOne({
            where: { orderId: orderId },
        });

        if (!order) {
            throw new NotFoundException(`Order with ID ${orderId} not found`);
        }

        // Validate ownership
        if (order.walletAddress !== walletAddress) {
            throw new ForbiddenException("You do not own this order");
        }

        // Validate status - can only cancel open or partial orders
        const cancellableStatuses = [
            OrderStatus.Open,
            OrderStatus.Partial,
        ] as OrderStatus[];
        if (!cancellableStatuses.includes(order.status)) {
            throw new BadRequestException(
                "Order can only be cancelled when status is open or partial",
            );
        }

        const previousStatus = order.status;
        const previousRemaining = order.remainingAmount;

        // Update order
        order.status = OrderStatus.Cancelled;
        order.cancelledAt = new Date();

        const updatedOrder = await this.orderRepository.save(order);

        // Create history entry
        await this.createOrderHistoryEntry(
            orderId,
            previousStatus,
            OrderStatus.Cancelled,
            previousRemaining,
            order.remainingAmount,
            order_history_reasons.order_cancelled_by_user,
        );

        // Publish cancellation event to NATS
        await this.publishCancelOrderToNats(orderId, walletAddress);

        return updatedOrder;
    }



    private async createOrderHistoryEntry(
        orderId: string,
        previousStatus: string | null,
        newStatus: string,
        previousRemainingAmount: string | null,
        newRemainingAmount: string,
        changeReason: string,
        transactionHash?: string,
    ): Promise<void> {
        const history = this.orderHistoryRepository.create({
            orderId,
            previousStatus: previousStatus as any,
            newStatus: newStatus as any,
            previousRemainingAmount,
            newRemainingAmount,
            changeReason,
            transactionHash: transactionHash || null,
        });

        await this.orderHistoryRepository.save(history);
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
            this.logger.debug(`Published order ${order.orderId} to ${subject}`);
        } catch (error) {
            this.logger.error(
                `Failed to publish order ${order.orderId} to NATS: ${error.message}`,
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
