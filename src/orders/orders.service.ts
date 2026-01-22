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
import type { CreateBorrowLimitOrderDto } from "./dto/create-borrow-limit-order.dto";
import type { CreateBorrowMarketOrderDto } from "./dto/create-borrow-market-order.dto";
import type { CreateLendLimitOrderDto } from "./dto/create-lend-limit-order.dto";
import type { CreateLendMarketOrderDto } from "./dto/create-lend-market-order.dto";
import { Order } from "./entities/order.entity";
import { Account } from "./entities/account.entity";
import { Token } from "../tokens/entities/token.entity";

@Injectable()
export class OrdersService {
    private readonly logger = new Logger(OrdersService.name);

    constructor(
        @InjectRepository(Order)
        private readonly orderRepository: Repository<Order>,
        @InjectRepository(Account)
        private readonly accountRepository: Repository<Account>,
        @InjectRepository(Token)
        private readonly tokenRepository: Repository<Token>,
        private readonly tokensService: TokensService,
        private readonly natsService: NatsService,
    ) {}

    private async getOrCreateAccount(walletAddress: string, privyUserId: string): Promise<string> {
        let account = await this.accountRepository.findOne({
            where: { userWallet: walletAddress },
        });

        if (!account) {
            this.logger.log(`Creating new account for wallet ${walletAddress} (Privy: ${privyUserId})`);
            account = this.accountRepository.create({
                userWallet: walletAddress,
                privyUserId: privyUserId,
            });
            account = await this.accountRepository.save(account);
        }
        
        return account.id;
    }

    private async getAssetId(tokenAddress: string): Promise<string> {
        const token = await this.tokenRepository.findOne({
            where: { tokenAddress },
        });
        if (!token) {
            throw new NotFoundException(`Asset for token ${tokenAddress} not found`);
        }
        return token.id;
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
        const order = await this.orderRepository.findOne({
            where: { id: orderId },
        });

        if (!order) {
            throw new NotFoundException(`Order with ID ${orderId} not found`);
        }
        
        // For cancellation, we expect the account to exist because the order exists.
        // We just need to verify ownership.
        const account = await this.accountRepository.findOne({
             where: { userWallet: walletAddress }
        });
        
        if (!account) {
             throw new ForbiddenException("Account not found for this wallet");
        }

        const accountId = account.id;

        // Validate ownership
        if (order.accountId !== accountId) {
            throw new ForbiddenException("You do not own this order");
        }

        // Validate status - can only cancel open or partial orders
        const cancellableStatuses = [
            OrderStatus.Open,
            OrderStatus.PartiallyFilled,
        ] as OrderStatus[];

        if (!cancellableStatuses.includes(order.status)) {
            throw new BadRequestException(
                "Order can only be cancelled when status is open or partial",
            );
        }

        // Update order
        order.status = OrderStatus.Cancelled;

        const updatedOrder = await this.orderRepository.save(order);

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
