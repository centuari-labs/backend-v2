import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
    Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Order } from "./entities/order.entity";
import { OrderHistory } from "./entities/order-history.entity";
import { TokensService } from "../tokens/tokens.service";
import { NatsService } from "../core/nats/nats.service";
import type { CreateLendMarketOrderDto } from "./dto/create-lend-market-order.dto";
import type { CreateLendLimitOrderDto } from "./dto/create-lend-limit-order.dto";
import type { CreateBorrowMarketOrderDto } from "./dto/create-borrow-market-order.dto";
import type { CreateBorrowLimitOrderDto } from "./dto/create-borrow-limit-order.dto";
import {
    order_type,
    order_category,
    order_status,
} from "./constants/order.constants";
import { nats_subjects } from "./constants/nats-subjects.constants";
import { order_history_reasons } from "./constants/order-history.constants";

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
            orderType: order_type.lend_market,
            orderCategory: order_category.lend,
            isMarketOrder: true,
            assetAddress: dto.loanToken,
            amount: dto.amount,
            remainingAmount: dto.amount,
            status: order_status.pending,
            durationDays: this.calculateDurationDays(dto.dates),
        });

        const savedOrder = await this.orderRepository.save(order);

        await this.createOrderHistoryEntry(
            savedOrder.id,
            null,
            order_status.pending,
            null,
            "0",
            order_history_reasons.order_created,
        );

        await this.publishOrderToNats(
            nats_subjects.orders.lend.market.created,
            savedOrder,
        );

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
            orderType: order_type.lend_limit,
            orderCategory: order_category.lend,
            isMarketOrder: false,
            assetAddress: dto.loanToken,
            amount: dto.amount,
            remainingAmount: dto.amount,
            interestRate: dto.interestRate.toString(),
            status: order_status.pending,
            durationDays: this.calculateDurationDays(dto.dates),
        });

        const savedOrder = await this.orderRepository.save(order);

        await this.createOrderHistoryEntry(
            savedOrder.id,
            null,
            order_status.pending,
            null,
            "0",
            order_history_reasons.order_created,
        );

        await this.publishOrderToNats(
            nats_subjects.orders.lend.limit.created,
            savedOrder,
        );

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
            orderType: order_type.borrow_market,
            orderCategory: order_category.borrow,
            isMarketOrder: true,
            assetAddress: dto.loanToken,
            amount: dto.amount,
            remainingAmount: dto.amount,
            status: order_status.pending,
            durationDays: this.calculateDurationDays(dto.dates),
        });

        const savedOrder = await this.orderRepository.save(order);

        await this.createOrderHistoryEntry(
            savedOrder.id,
            null,
            order_status.pending,
            null,
            "0",
            order_history_reasons.order_created,
        );

        await this.publishOrderToNats(
            nats_subjects.orders.borrow.market.created,
            savedOrder,
        );

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
            orderType: order_type.borrow_limit,
            orderCategory: order_category.borrow,
            isMarketOrder: false,
            assetAddress: dto.loanToken,
            amount: dto.amount,
            remainingAmount: dto.amount,
            interestRate: dto.interestRate.toString(),
            status: order_status.pending,
            durationDays: this.calculateDurationDays(dto.dates),
        });

        const savedOrder = await this.orderRepository.save(order);

        await this.createOrderHistoryEntry(
            savedOrder.id,
            null,
            order_status.pending,
            null,
            "0",
            order_history_reasons.order_created,
        );

        await this.publishOrderToNats(
            nats_subjects.orders.borrow.limit.created,
            savedOrder,
        );

        return savedOrder;
    }

    async cancelOrder(orderId: number, walletAddress: string): Promise<Order> {
        // Find the order
        const order = await this.orderRepository.findOne({
            where: { id: orderId },
        });

        if (!order) {
            throw new NotFoundException(`Order with ID ${orderId} not found`);
        }

        // Validate ownership
        if (order.walletAddress !== walletAddress) {
            throw new ForbiddenException("You do not own this order");
        }

        // Validate status - can only cancel pending or partial orders
        const cancellableStatuses = [order_status.pending, order_status.partial] as string[];
        if (!cancellableStatuses.includes(order.status)) {
            throw new BadRequestException(
                "Order can only be cancelled when status is pending or partial"
            );
        }

        const previousStatus = order.status;
        
        // Update order
        order.status = order_status.cancelled;
        order.cancelledAt = new Date();
        
        const updatedOrder = await this.orderRepository.save(order);

        // Create history entry
        await this.createOrderHistoryEntry(
            orderId,
            previousStatus,
            order_status.cancelled,
            order.filledAmount,
            order.filledAmount,
            order_history_reasons.order_cancelled_by_user,
        );

        // Publish cancellation event to NATS
        await this.publishCancelOrderToNats(orderId, walletAddress);

        return updatedOrder;
    }

    private calculateDurationDays(dates: string[]): number {
        if (!dates || dates.length === 0) return 0;
        
        const now = new Date();
        const latestDate = dates
            .map(d => new Date(d))
            .reduce((latest, current) => current > latest ? current : latest);
        
        const diffTime = latestDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        return Math.max(0, diffDays);
    }

    private async createOrderHistoryEntry(
        orderId: number,
        previousStatus: string | null,
        newStatus: string,
        previousFilledAmount: string | null,
        newFilledAmount: string,
        changeReason: string,
        transactionHash?: string,
    ): Promise<void> {
        const history = this.orderHistoryRepository.create({
            orderId,
            previousStatus: previousStatus as any,
            newStatus: newStatus as any,
            previousFilledAmount,
            newFilledAmount,
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
            this.logger.debug(`Published order ${order.id} to ${subject}`);
        } catch (error) {
            this.logger.error(
                `Failed to publish order ${order.id} to NATS: ${error.message}`,
            );
        }
    }

    private async publishCancelOrderToNats(
        orderId: number,
        walletAddress: string,
    ): Promise<void> {
        const subject = nats_subjects.orders.cancel;
        try {
            await this.natsService.publish(subject, {
                event: subject,
                timestamp: new Date().toISOString(),
                data: {
                    orderId,
                    walletAddress,
                },
            });
            this.logger.debug(`Published cancel order ${orderId} to ${subject}`);
        } catch (error) {
            this.logger.error(
                `Failed to publish cancel order ${orderId} to NATS: ${error.message}`,
            );
        }
    }
}
