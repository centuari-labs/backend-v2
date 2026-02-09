import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { Repository } from "typeorm";
import { OrderSide, OrderStatus, OrderType } from "./constants/order.constants";
import { Account } from "./entities/account.entity";
import { Order } from "./entities/order.entity";
import { OrderRepository } from "./repositories/order.repository";

const INSERT_INTERVAL_MS = Number.parseInt(process.env.ORDER_WORKER_INSERT_INTERVAL_MS ?? "5000", 10);
const PARTIAL_FILL_INTERVAL_MS = Number.parseInt(process.env.ORDER_WORKER_PARTIAL_FILL_INTERVAL_MS ?? "7000", 10);
const MAX_OPEN_ORDERS = Number.parseInt(process.env.ORDER_WORKER_MAX_OPEN_ORDERS ?? "500", 10);

const RATE_MIN = Number.parseFloat(process.env.ORDER_WORKER_RATE_MIN ?? "0.01");
const RATE_MAX = Number.parseFloat(process.env.ORDER_WORKER_RATE_MAX ?? "0.25");
const QUANTITY_MIN = Number.parseFloat(process.env.ORDER_WORKER_QUANTITY_MIN ?? "0.1");
const QUANTITY_MAX = Number.parseFloat(process.env.ORDER_WORKER_QUANTITY_MAX ?? "1000");
const SETTLEMENT_FEE_MIN = Number.parseFloat(process.env.ORDER_WORKER_SETTLEMENT_FEE_MIN ?? "0.0001");
const SETTLEMENT_FEE_MAX = Number.parseFloat(process.env.ORDER_WORKER_SETTLEMENT_FEE_MAX ?? "0.01");
const PARTIAL_FILL_MIN_FRACTION = Number.parseFloat(process.env.ORDER_WORKER_PARTIAL_FILL_MIN_FRACTION ?? "0.05");
const PARTIAL_FILL_MAX_FRACTION = Number.parseFloat(process.env.ORDER_WORKER_PARTIAL_FILL_MAX_FRACTION ?? "0.25");

const ACCOUNT_ID_POOL = (process.env.ORDER_WORKER_ACCOUNT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const ASSET_ID_POOL = (process.env.ORDER_WORKER_ASSET_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

@Injectable()
export class OrdersWorker {
    private readonly logger = new Logger(OrdersWorker.name);
    private readonly generatedAccountIds: string[] = [];

    constructor(
        @InjectRepository(Order)
        private readonly orderRepository: OrderRepository,
        @InjectRepository(Account)
        private readonly accountRepository: Repository<Account>,
    ) {
        if (ACCOUNT_ID_POOL.length === 0 || ASSET_ID_POOL.length === 0) {
            this.logger.warn(
                "ORDER_WORKER_ACCOUNT_IDS or ORDER_WORKER_ASSET_IDS not set. Accounts will be created automatically; assets will use random UUIDs.",
            );
        }
    }

    @Interval(INSERT_INTERVAL_MS)
    async createRandomOrder(): Promise<void> {
        try {
            const openCount = await this.orderRepository.count({ where: { status: OrderStatus.Open } });
            if (openCount >= MAX_OPEN_ORDERS) {
                return;
            }

            const order = this.orderRepository.create({
                accountId: await this.getOrCreateAccountId(),
                assetId: this.getRandomAssetId(),
                side: this.getRandomSide(),
                type: this.getRandomType(),
                rate: this.getRandomNumber(RATE_MIN, RATE_MAX, 6),
                quantity: this.getRandomNumber(QUANTITY_MIN, QUANTITY_MAX, 6).toString(),
                settlementFee: this.getRandomNumber(SETTLEMENT_FEE_MIN, SETTLEMENT_FEE_MAX, 6).toString(),
                status: OrderStatus.Open,
            });

            await this.orderRepository.save(order);
        } catch (error) {
            this.logger.error(`Failed to insert order: ${(error as Error).message}`);
        }
    }

    @Interval(PARTIAL_FILL_INTERVAL_MS)
    async partiallyFillRandomOrder(): Promise<void> {
        try {
            const order = await this.orderRepository
                .createQueryBuilder("order")
                .where("order.status IN (:...statuses)", {
                    statuses: [OrderStatus.Open, OrderStatus.PartiallyFilled],
                })
                .orderBy("RANDOM()")
                .getOne();

            if (!order) {
                return;
            }

            const quantity = Number.parseFloat(order.quantity);
            const filledQuantity = Number.parseFloat(order.filledQuantity ?? "0");
            const remaining = Math.max(quantity - filledQuantity, 0);
            if (remaining <= 0) {
                return;
            }

            const increment = this.getRandomNumber(
                remaining * PARTIAL_FILL_MIN_FRACTION,
                remaining * PARTIAL_FILL_MAX_FRACTION,
                6,
            );

            const nextFilledQuantity = Math.min(filledQuantity + increment, quantity);
            order.filledQuantity = nextFilledQuantity.toString();
            order.status = OrderStatus.PartiallyFilled;

            const settlementFee = Number.parseFloat(order.settlementFee ?? "0");
            if (settlementFee > 0) {
                const filledSettlementFee = (settlementFee * nextFilledQuantity) / quantity;
                order.filledSettlementFee = filledSettlementFee.toString();
            }

            await this.orderRepository.save(order);
        } catch (error) {
            this.logger.error(`Failed to update order partial fill: ${(error as Error).message}`);
        }
    }

    private getRandomSide(): OrderSide {
        return Math.random() < 0.5 ? OrderSide.Lend : OrderSide.Borrow;
    }

    private getRandomType(): OrderType {
        return Math.random() < 0.5 ? OrderType.Market : OrderType.Limit;
    }

    private async getOrCreateAccountId(): Promise<string> {
        if (ACCOUNT_ID_POOL.length > 0) {
            return ACCOUNT_ID_POOL[Math.floor(Math.random() * ACCOUNT_ID_POOL.length)];
        }

        if (this.generatedAccountIds.length > 0) {
            return this.generatedAccountIds[Math.floor(Math.random() * this.generatedAccountIds.length)];
        }

        const account = this.accountRepository.create({
            privyUserId: randomUUID(),
            userWallet: this.getRandomWalletAddress(),
        });
        const savedAccount = await this.accountRepository.save(account);
        this.generatedAccountIds.push(savedAccount.id);
        return savedAccount.id;
    }

    private getRandomAssetId(): string {
        if (ASSET_ID_POOL.length > 0) {
            return ASSET_ID_POOL[Math.floor(Math.random() * ASSET_ID_POOL.length)];
        }
        return randomUUID();
    }

    private getRandomNumber(min: number, max: number, decimals: number): number {
        const lower = Math.min(min, max);
        const upper = Math.max(min, max);
        const value = lower + Math.random() * (upper - lower);
        const factor = Math.pow(10, decimals);
        return Math.round(value * factor) / factor;
    }

    private getRandomWalletAddress(): string {
        const chars = "0123456789abcdef";
        let value = "0x";
        for (let i = 0; i < 40; i += 1) {
            value += chars[Math.floor(Math.random() * chars.length)];
        }
        return value;
    }
}
