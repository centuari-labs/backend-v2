import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { OrderSide, OrderStatus, OrderType } from "./constants/order.constants";
import { Order } from "./entities/order.entity";
import { OrderRepository } from "./repositories/order.repository";
import { OrdersService } from "./orders.service";

const INSERT_INTERVAL_MS = Number.parseInt(process.env.ORDER_WORKER_INSERT_INTERVAL_MS ?? "5000", 10);
const PARTIAL_FILL_INTERVAL_MS = Number.parseInt(process.env.ORDER_WORKER_PARTIAL_FILL_INTERVAL_MS ?? "7000", 10);
const MAX_OPEN_ORDERS = Number.parseInt(process.env.ORDER_WORKER_MAX_OPEN_ORDERS ?? "500", 10);

const RATE_MIN = Number.parseFloat(process.env.ORDER_WORKER_RATE_MIN ?? "0.01");
const RATE_MAX = Number.parseFloat(process.env.ORDER_WORKER_RATE_MAX ?? "0.25");
const QUANTITY_MIN = Number.parseFloat(process.env.ORDER_WORKER_QUANTITY_MIN ?? "0.1");
const QUANTITY_MAX = Number.parseFloat(process.env.ORDER_WORKER_QUANTITY_MAX ?? "1000");
const PARTIAL_FILL_MIN_FRACTION = Number.parseFloat(process.env.ORDER_WORKER_PARTIAL_FILL_MIN_FRACTION ?? "0.05");
const PARTIAL_FILL_MAX_FRACTION = Number.parseFloat(process.env.ORDER_WORKER_PARTIAL_FILL_MAX_FRACTION ?? "0.25");

const ASSET_ID_POOL = (process.env.ORDER_WORKER_ASSET_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const WALLET_ADDRESS_POOL = [
    "0xcA2E021f8FEA9E3fb5F86A68A3158315404e6157",
    "0xAb9A004468A39cCC07e1f62B59F990f45304a222",
    "0x43765641b3632f45366cD91D9F128CFeb34b218F",
    "0x103D2146DE8E682ca21eb2fbF9CF9a3e8a127749",
    "0xCeCe52a44e9e6E57051791E7472CA87b3D789c3e",
    "0xd0c75db43eBa0512D84e6f77104646809f1cac99",
];

@Injectable()
export class OrdersWorker {
    private readonly logger = new Logger(OrdersWorker.name);

    constructor(
        @InjectRepository(Order)
        private readonly orderRepository: OrderRepository,
        private readonly ordersService: OrdersService,
    ) {
        if (ASSET_ID_POOL.length === 0) {
            this.logger.warn(
                "ORDER_WORKER_ASSET_IDS not set. Random orders will be skipped until token addresses are provided.",
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

            const loanToken = this.getRandomLoanToken();
            if (!loanToken) {
                return;
            }

            const side = this.getRandomSide();
            const type = this.getRandomType();
            const amount = this.getRandomNumber(QUANTITY_MIN, QUANTITY_MAX, 6).toString();
            const rate = this.getRandomNumber(RATE_MIN, RATE_MAX, 6);
            const maturities = [30];
            const walletAddress = this.getRandomWalletFromPool();
            const privyUserId = randomUUID();

            if (side === OrderSide.Lend && type === OrderType.Market) {
                await this.ordersService.createLendMarketOrder(
                    { loanToken, amount, maturities },
                    walletAddress,
                    privyUserId,
                );
                return;
            }

            if (side === OrderSide.Lend && type === OrderType.Limit) {
                await this.ordersService.createLendLimitOrder(
                    { loanToken, amount, maturities, rate },
                    walletAddress,
                    privyUserId,
                );
                return;
            }

            if (side === OrderSide.Borrow && type === OrderType.Market) {
                await this.ordersService.createBorrowMarketOrder(
                    { loanToken, amount, maturities },
                    walletAddress,
                    privyUserId,
                );
                return;
            }

            await this.ordersService.createBorrowLimitOrder(
                { loanToken, amount, maturities, rate },
                walletAddress,
                privyUserId,
            );
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

    private getRandomLoanToken(): string | null {
        if (ASSET_ID_POOL.length > 0) {
            return ASSET_ID_POOL[Math.floor(Math.random() * ASSET_ID_POOL.length)];
        }
        return null;
    }

    private getRandomWalletFromPool(): string {
        return WALLET_ADDRESS_POOL[Math.floor(Math.random() * WALLET_ADDRESS_POOL.length)];
    }

    private getRandomNumber(min: number, max: number, decimals: number): number {
        const lower = Math.min(min, max);
        const upper = Math.max(min, max);
        const value = lower + Math.random() * (upper - lower);
        const factor = 10 ** decimals
        return Math.round(value * factor) / factor;
    }
}
