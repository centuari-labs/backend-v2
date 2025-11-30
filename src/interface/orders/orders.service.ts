import {
    Injectable,
    NotFoundException,
    BadRequestException,
    Logger,
} from "@nestjs/common";
import { DatabaseService } from "../../core/database/database.service";
import { ViemService } from "../../core/viem/viem.service";
import { NatsService } from "../../core/nats/nats.service";
import type { Order } from "./entities/order.entity";
import type { OrderGroup } from "./entities/order-group.entity";
import type { CreateOrderGroupDto } from "./dto/create-order-group.dto";
import type { CreateLendMarketOrderDto } from "./dto/create-lend-market-order.dto";
import type { CreateLendLimitOrderDto } from "./dto/create-lend-limit-order.dto";
import type { CreateBorrowMarketOrderDto } from "./dto/create-borrow-market-order.dto";
import type { CreateBorrowLimitOrderDto } from "./dto/create-borrow-limit-order.dto";
import {
    ORDER_TYPE,
    ORDER_CATEGORY,
    ORDER_STATUS,
} from "./constants/order.constants";
import { NATS_SUBJECTS } from "./constants/nats-subjects.constants";
import { ERROR_MESSAGES } from "./constants/error-messages.constants";
import { ORDER_HISTORY_REASONS } from "./constants/order-history.constants";

interface CreateOrderParams {
    orderType: string;
    orderCategory: string;
    isMarketOrder: boolean;
    natsSubject: string;
    dto:
        | CreateLendMarketOrderDto
        | CreateLendLimitOrderDto
        | CreateBorrowMarketOrderDto
        | CreateBorrowLimitOrderDto;
}

@Injectable()
export class OrdersService {
    private readonly logger = new Logger(OrdersService.name);

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly viemService: ViemService,
        private readonly natsService: NatsService,
    ) {}

    async createOrderGroup(dto: CreateOrderGroupDto): Promise<OrderGroup> {
        this.validateWalletAddress(dto.wallet_address);

        const result = await this.databaseService.query<OrderGroup>(
            `
            INSERT INTO order_groups (wallet_address, name, description)
            VALUES ($1, $2, $3)
            RETURNING *
        `,
            [dto.wallet_address, dto.name || null, dto.description || null],
        );

        return result[0];
    }

    async getOrderGroup(id: number): Promise<OrderGroup> {
        const group = await this.databaseService.queryOne<OrderGroup>(
            "SELECT * FROM order_groups WHERE id = $1",
            [id],
        );

        if (!group) {
            throw new NotFoundException(ERROR_MESSAGES.ORDER_GROUP_NOT_FOUND(id));
        }

        return group;
    }

    async getOrderGroupsByWallet(
        walletAddress: string,
    ): Promise<OrderGroup[]> {
        return this.databaseService.query<OrderGroup>(
            "SELECT * FROM order_groups WHERE wallet_address = $1 ORDER BY created_at DESC",
            [walletAddress],
        );
    }

    async updateOrderGroupStatus(
        id: number,
        status: "active" | "cancelled" | "completed",
    ): Promise<OrderGroup> {
        const result = await this.databaseService.query<OrderGroup>(
            `
            UPDATE order_groups
            SET status = $1
            WHERE id = $2
            RETURNING *
        `,
            [status, id],
        );

        if (result.length === 0) {
            throw new NotFoundException(ERROR_MESSAGES.ORDER_GROUP_NOT_FOUND(id));
        }

        return result[0];
    }

    async createLendMarketOrder(
        dto: CreateLendMarketOrderDto,
    ): Promise<Order> {
        return this.createOrder({
            orderType: ORDER_TYPE.LEND_MARKET,
            orderCategory: ORDER_CATEGORY.LEND,
            isMarketOrder: true,
            natsSubject: NATS_SUBJECTS.ORDERS.LEND.MARKET.CREATED,
            dto,
        });
    }

    async createLendLimitOrder(dto: CreateLendLimitOrderDto): Promise<Order> {
        return this.createOrder({
            orderType: ORDER_TYPE.LEND_LIMIT,
            orderCategory: ORDER_CATEGORY.LEND,
            isMarketOrder: false,
            natsSubject: NATS_SUBJECTS.ORDERS.LEND.LIMIT.CREATED,
            dto,
        });
    }

    async createBorrowMarketOrder(
        dto: CreateBorrowMarketOrderDto,
    ): Promise<Order> {
        this.validateCollateralAddress(dto.collateral_asset_address);

        return this.createOrder({
            orderType: ORDER_TYPE.BORROW_MARKET,
            orderCategory: ORDER_CATEGORY.BORROW,
            isMarketOrder: true,
            natsSubject: NATS_SUBJECTS.ORDERS.BORROW.MARKET.CREATED,
            dto,
        });
    }

    async createBorrowLimitOrder(
        dto: CreateBorrowLimitOrderDto,
    ): Promise<Order> {
        this.validateCollateralAddress(dto.collateral_asset_address);

        return this.createOrder({
            orderType: ORDER_TYPE.BORROW_LIMIT,
            orderCategory: ORDER_CATEGORY.BORROW,
            isMarketOrder: false,
            natsSubject: NATS_SUBJECTS.ORDERS.BORROW.LIMIT.CREATED,
            dto,
        });
    }
    async getOrder(id: number): Promise<Order> {
        const order = await this.databaseService.queryOne<Order>(
            "SELECT * FROM orders WHERE id = $1",
            [id],
        );

        if (!order) {
            throw new NotFoundException(ERROR_MESSAGES.ORDER_NOT_FOUND(id));
        }

        return order;
    }

    async getOrdersByWallet(walletAddress: string): Promise<Order[]> {
        return this.databaseService.query<Order>(
            "SELECT * FROM orders WHERE wallet_address = $1 ORDER BY created_at DESC",
            [walletAddress],
        );
    }

    async getOrdersByGroup(orderGroupId: number): Promise<Order[]> {
        return this.databaseService.query<Order>(
            "SELECT * FROM orders WHERE order_group_id = $1 ORDER BY created_at DESC",
            [orderGroupId],
        );
    }

    async getOrdersByType(
        orderType: "lend_market" | "lend_limit" | "borrow_market" | "borrow_limit",
    ): Promise<Order[]> {
        return this.databaseService.query<Order>(
            "SELECT * FROM orders WHERE order_type = $1 ORDER BY created_at DESC",
            [orderType],
        );
    }

    async getOrdersByStatus(
        status: "pending" | "partial" | "filled" | "cancelled",
    ): Promise<Order[]> {
        return this.databaseService.query<Order>(
            "SELECT * FROM orders WHERE status = $1 ORDER BY created_at DESC",
            [status],
        );
    }

    async cancelOrder(id: number): Promise<Order> {
        const result = await this.databaseService.query<Order>(
            `
            UPDATE orders
            SET status = $1, cancelled_at = CURRENT_TIMESTAMP
            WHERE id = $2 AND status IN ($3, $4)
            RETURNING *
        `,
            [ORDER_STATUS.CANCELLED, id, ORDER_STATUS.PENDING, ORDER_STATUS.PARTIAL],
        );

        if (result.length === 0) {
            throw new NotFoundException(
                ERROR_MESSAGES.ORDER_CANNOT_BE_CANCELLED(id),
            );
        }

        await this.createOrderHistoryEntry(
            id,
            result[0].status,
            ORDER_STATUS.CANCELLED,
            result[0].filled_amount,
            result[0].filled_amount,
            ORDER_HISTORY_REASONS.ORDER_CANCELLED_BY_USER,
        );

        return result[0];
    }

    async updateOrderStatus(
        id: number,
        status: "pending" | "partial" | "filled" | "cancelled",
        filledAmount?: string,
        transactionHash?: string,
        blockNumber?: number,
    ): Promise<Order> {
        const order = await this.getOrder(id);

        const updates: string[] = ["status = $2"];
        const params: (string | number)[] = [id, status];
        let paramIndex = 3;

        if (filledAmount !== undefined) {
            updates.push(`filled_amount = $${paramIndex}`);
            params.push(filledAmount);
            paramIndex++;

            const remaining = this.calculateRemainingAmount(
                order.amount,
                filledAmount,
            );
            updates.push(`remaining_amount = $${paramIndex}`);
            params.push(remaining);
            paramIndex++;
        }

        if (transactionHash !== undefined) {
            updates.push(`transaction_hash = $${paramIndex}`);
            params.push(transactionHash);
            paramIndex++;
        }

        if (blockNumber !== undefined) {
            updates.push(`block_number = $${paramIndex}`);
            params.push(blockNumber);
            paramIndex++;
        }

        if (status === ORDER_STATUS.FILLED) {
            updates.push("filled_at = CURRENT_TIMESTAMP");
        }

        const result = await this.databaseService.query<Order>(
            `
            UPDATE orders
            SET ${updates.join(", ")}
            WHERE id = $1
            RETURNING *
        `,
            params,
        );

        await this.createOrderHistoryEntry(
            id,
            order.status,
            status,
            order.filled_amount,
            filledAmount || order.filled_amount,
            ORDER_HISTORY_REASONS.ORDER_UPDATED,
            transactionHash,
        );

        return result[0];
    }

    private async createOrder(params: CreateOrderParams): Promise<Order> {
        const { orderType, orderCategory, isMarketOrder, natsSubject, dto } = params;

        this.validateWalletAddress(dto.wallet_address);
        this.validateAssetAddress(dto.asset_address);

        if (dto.order_group_id) {
            await this.getOrderGroup(dto.order_group_id);
        }

        const orderData = this.buildOrderData({
            dto,
            orderType,
            orderCategory,
            isMarketOrder,
        });

        const result = await this.insertOrder(orderData);

        await this.createOrderHistoryEntry(
            result[0].id,
            null,
            ORDER_STATUS.PENDING,
            null,
            "0",
            ORDER_HISTORY_REASONS.ORDER_CREATED,
        );

        await this.publishOrderToNats(natsSubject, result[0]);

        return result[0];
    }

    private buildOrderData(config: {
        dto:
            | CreateLendMarketOrderDto
            | CreateLendLimitOrderDto
            | CreateBorrowMarketOrderDto
            | CreateBorrowLimitOrderDto;
        orderType: string;
        orderCategory: string;
        isMarketOrder: boolean;
    }) {
        const { dto, orderType, orderCategory, isMarketOrder } = config;

        const baseData = {
            order_group_id: dto.order_group_id || null,
            wallet_address: dto.wallet_address,
            order_type: orderType,
            order_category: orderCategory,
            is_market_order: isMarketOrder,
            asset_address: dto.asset_address,
            amount: dto.amount,
            interest_rate: dto.interest_rate,
            duration_days: dto.duration_days,
            remaining_amount: dto.amount,
            status: ORDER_STATUS.PENDING,
        };

        const hasCollateral = "collateral_asset_address" in dto;
        const hasLimitPrice = "limit_price" in dto;

        if (hasCollateral) {
            const borrowDto = dto as CreateBorrowMarketOrderDto | CreateBorrowLimitOrderDto;
            const borrowData = {
                ...baseData,
                collateral_asset_address: borrowDto.collateral_asset_address,
                collateral_amount: borrowDto.collateral_amount,
                collateral_ratio: borrowDto.collateral_ratio,
            };

            if (hasLimitPrice) {
                const limitDto = dto as CreateBorrowLimitOrderDto;
                return {
                    ...borrowData,
                    limit_price: limitDto.limit_price,
                    limit_expiry: limitDto.limit_expiry || null,
                };
            }

            return borrowData;
        }

        if (hasLimitPrice) {
            const limitDto = dto as CreateLendLimitOrderDto;
            return {
                ...baseData,
                limit_price: limitDto.limit_price,
                limit_expiry: limitDto.limit_expiry || null,
            };
        }

        return baseData;
    }

    private async insertOrder(orderData: Record<string, unknown>): Promise<Order[]> {
        const columns = Object.keys(orderData);
        const values = Object.values(orderData);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");

        return this.databaseService.query<Order>(
            `
            INSERT INTO orders (${columns.join(", ")})
            VALUES (${placeholders})
            RETURNING *
        `,
            values,
        );
    }

    private validateWalletAddress(address: string): void {
        if (!this.viemService.isValidAddress(address)) {
            throw new BadRequestException(ERROR_MESSAGES.INVALID_WALLET_ADDRESS);
        }
    }

    private validateAssetAddress(address: string): void {
        if (!this.viemService.isValidAddress(address)) {
            throw new BadRequestException(ERROR_MESSAGES.INVALID_ASSET_ADDRESS);
        }
    }

    private validateCollateralAddress(address: string): void {
        if (!this.viemService.isValidAddress(address)) {
            throw new BadRequestException(
                ERROR_MESSAGES.INVALID_COLLATERAL_ASSET_ADDRESS,
            );
        }
    }

    private calculateRemainingAmount(
        totalAmount: string,
        filledAmount: string,
    ): string {
        const total = Number.parseFloat(totalAmount);
        const filled = Number.parseFloat(filledAmount);
        return (total - filled).toString();
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
        await this.databaseService.query(
            `
            INSERT INTO order_history (
                order_id,
                previous_status,
                new_status,
                previous_filled_amount,
                new_filled_amount,
                change_reason,
                transaction_hash
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
            [
                orderId,
                previousStatus,
                newStatus,
                previousFilledAmount,
                newFilledAmount,
                changeReason,
                transactionHash || null,
            ],
        );
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
            // Don't throw - order creation should succeed even if NATS publish fails
        }
    }
}
