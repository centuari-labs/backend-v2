import { InjectRepository } from "@nestjs/typeorm";
import { Injectable } from "@nestjs/common";
import { DataSource, In, Repository } from "typeorm";
import { Order } from "../entities/order.entity";
import { OrderMarket } from "../entities/order-market.entity";
import {
    OrderSide,
    OrderStatus,
    OrderType,
} from "../constants/order.constants";

export interface OrderForTracking {
    id: string;
    assetId: string;
    side: OrderSide;
    type: OrderType;
    rate: number;
    quantity: string;
    filledQuantity: string;
    settlementFee: string;
    accountId: string;
    status: OrderStatus;
    userWallet: string;
    markets: Array<{ marketId: string; maturity: number }>;
}
import { Account } from "../entities/account.entity";

@Injectable()
export class OrderRepository extends Repository<Order> {
    constructor(
        private dataSource: DataSource,
        @InjectRepository(Account)
        private accountRepository: Repository<Account>,
    ) {
        super(Order, dataSource.createEntityManager());
    }

    /**
     * Inserts one row into `orders` and one row per market into `order_markets` in a single transaction.
     */
    async saveOrderWithMarkets(
        order: Order,
        marketIds: string[],
    ): Promise<Order> {
        return this.dataSource.transaction(async (manager) => {
            const orderRepo = manager.getRepository(Order);
            const orderMarketRepo = manager.getRepository(OrderMarket);

            const savedOrder = await orderRepo.save(order);
            for (const marketId of marketIds) {
                await orderMarketRepo.save({
                    orderId: savedOrder.id,
                    marketId,
                });
            }
            return savedOrder;
        });
    }

    async getOrCreateAccount(
        walletAddress: string,
        privyUserId: string,
    ): Promise<Account> {
        let account = await this.accountRepository.findOne({
            where: { userWallet: walletAddress },
        });

        if (!account) {
            account = this.accountRepository.create({
                userWallet: walletAddress,
                privyUserId: privyUserId,
            });
            account = await this.accountRepository.save(account);
        }

        return account;
    }

    async getBestRates(): Promise<
        Map<string, { borrow: number; lend: number }>
    > {
        const rawResults = await this.createQueryBuilder("order")
            .select("order.assetId", "assetId")
            .addSelect(
                "MAX(NULLIF(CASE WHEN order.side = :borrowSide THEN order.rate ELSE NULL END, 0))",
                "highestBorrow",
            )
            .addSelect(
                "MIN(NULLIF(CASE WHEN order.side = :lendSide THEN order.rate ELSE NULL END, 0))",
                "lowestLend",
            )
            .where("order.status IN (:...statuses)", {
                statuses: [OrderStatus.Open, OrderStatus.PartiallyFilled],
            })
            .setParameters({
                borrowSide: OrderSide.Borrow,
                lendSide: OrderSide.Lend,
            })
            .groupBy("order.assetId")
            .getRawMany();

        const rateMap = new Map<string, { borrow: number; lend: number }>();
        for (const rate of rawResults) {
            rateMap.set(rate.assetId, {
                borrow: rate.highestBorrow
                    ? Number.parseFloat(rate.highestBorrow)
                    : 0,
                lend: rate.lowestLend ? Number.parseFloat(rate.lowestLend) : 0,
            });
        }
        return rateMap;
    }

    async getOrderById(id: string): Promise<Order | null> {
        return this.findOne({
            where: { id },
        });
    }

    async getOpenOrders(assetId?: string): Promise<Order[]> {
        return this.find({
            where: {
                status: OrderStatus.Open,
                assetId,
            },
        });
    }

    async findAccountByWallet(walletAddress: string): Promise<Account | null> {
        return this.accountRepository
            .createQueryBuilder("account")
            .where("LOWER(account.user_wallet) = LOWER(:walletAddress)", {
                walletAddress,
            })
            .getOne();
    }

    async getTotalOpenQuantity(
        accountId: string,
        assetId: string,
        side: OrderSide,
    ): Promise<bigint> {
        const result = await this.createQueryBuilder("order")
            .select(
                "SUM(order.quantity - COALESCE(order.filled_quantity, 0))",
                "total",
            )
            .where("order.accountId = :accountId", { accountId })
            .andWhere("order.assetId = :assetId", { assetId })
            .andWhere("order.side = :side", { side })
            .andWhere("order.status IN (:...statuses)", {
                statuses: [OrderStatus.Open, OrderStatus.PartiallyFilled],
            })
            .getRawOne();

        if (!result || !result.total) {
            return 0n;
        }

        const totalStr = String(result.total).split(".")[0];
        return BigInt(totalStr);
    }

    /**
     * Returns true when at least one open/partially-filled LIMIT order exists
     * on the opposite side for the given asset and overlapping markets.
     *
     * Used to pre-check liquidity before accepting a market order.
     */
    async hasCounterpartyOrders(
        assetId: string,
        side: OrderSide,
        marketIds: string[],
        excludeAccountId?: string,
    ): Promise<boolean> {
        if (!marketIds.length) return false;

        const counterpartySide =
            side === OrderSide.Lend ? OrderSide.Borrow : OrderSide.Lend;

        const qb = this.createQueryBuilder("order")
            .innerJoin("order_markets", "om", "om.order_id = order.id")
            .where("order.assetId = :assetId", { assetId })
            .andWhere("order.side = :side", { side: counterpartySide })
            .andWhere("order.type = :type", { type: "LIMIT" })
            .andWhere("order.status IN (:...statuses)", {
                statuses: [OrderStatus.Open, OrderStatus.PartiallyFilled],
            })
            .andWhere("om.market_id IN (:...marketIds)", { marketIds });

        // Exclude own orders — matching engine won't match self anyway
        if (excludeAccountId) {
            qb.andWhere("order.accountId != :excludeAccountId", {
                excludeAccountId,
            });
        }

        const result = await qb.limit(1).getCount();

        return result > 0;
    }

    async getBestRatesForAsset(
        assetId: string,
    ): Promise<{ bestLendRate: number | null; bestBorrowRate: number | null }> {
        const result = await this.createQueryBuilder("order")
            .select(
                "MIN(CASE WHEN order.side = :lendSide THEN order.rate ELSE NULL END)",
                "bestLendRate",
            )
            .addSelect(
                "MAX(CASE WHEN order.side = :borrowSide THEN order.rate ELSE NULL END)",
                "bestBorrowRate",
            )
            .where("order.assetId = :assetId", { assetId })
            .andWhere("order.status IN (:...statuses)", {
                statuses: [OrderStatus.Open, OrderStatus.PartiallyFilled],
            })
            .andWhere("order.type = :type", { type: "LIMIT" })
            .setParameters({
                lendSide: OrderSide.Lend,
                borrowSide: OrderSide.Borrow,
            })
            .getRawOne();

        return {
            bestLendRate: result?.bestLendRate
                ? Number(result.bestLendRate)
                : null,
            bestBorrowRate: result?.bestBorrowRate
                ? Number(result.bestBorrowRate)
                : null,
        };
    }

    async getOpenBorrowOrders(accountId: string): Promise<Order[]> {
        return this.find({
            where: {
                accountId,
                side: OrderSide.Borrow,
                status: In([OrderStatus.Open, OrderStatus.PartiallyFilled]),
            },
        });
    }

    /**
     * Returns the sum of (quantity - filled_quantity) for all open/partially-filled
     * lend orders belonging to the given account, grouped by asset_id.
     */
    async getOpenLendAmountsByAccount(
        accountId: string,
    ): Promise<{ assetId: string; lockedAmount: string }[]> {
        return this.createQueryBuilder("o")
            .select("o.assetId", "assetId")
            .addSelect(
                "SUM(o.quantity::numeric - o.filled_quantity::numeric)",
                "lockedAmount",
            )
            .where("o.account_id = :accountId", { accountId })
            .andWhere("o.side = :side", { side: OrderSide.Lend })
            .andWhere("o.status IN (:...statuses)", {
                statuses: [OrderStatus.Open, OrderStatus.PartiallyFilled],
            })
            .groupBy("o.assetId")
            .getRawMany();
    }

    /**
     * Loads all active LIMIT orders for an asset with account wallet and market data.
     * Used by the WebSocket gateway to hydrate the in-memory orderbook state.
     */
    async findActiveLimitOrdersForOrderbook(
        assetId: string,
    ): Promise<OrderForTracking[]> {
        const rows = await this.createQueryBuilder("o")
            .select("o.id", "id")
            .addSelect("o.asset_id", "assetId")
            .addSelect("o.side", "side")
            .addSelect("o.type", "type")
            .addSelect("o.rate", "rate")
            .addSelect("o.quantity", "quantity")
            .addSelect("o.filled_quantity", "filledQuantity")
            .addSelect("o.settlement_fee", "settlementFee")
            .addSelect("o.account_id", "accountId")
            .addSelect("o.status", "status")
            .addSelect("a.user_wallet", "userWallet")
            .addSelect(
                `json_agg(json_build_object('marketId', om.market_id, 'maturity', COALESCE(EXTRACT(EPOCH FROM m.maturity)::int, 0))) FILTER (WHERE om.market_id IS NOT NULL)`,
                "markets",
            )
            .innerJoin("accounts", "a", "a.id = o.account_id")
            .leftJoin("order_markets", "om", "om.order_id = o.id")
            .leftJoin("markets", "m", "m.id = om.market_id")
            .where("o.asset_id = :assetId", { assetId })
            .andWhere("o.type = :type", { type: OrderType.Limit })
            .andWhere("o.status IN (:...statuses)", {
                statuses: [OrderStatus.Open, OrderStatus.PartiallyFilled],
            })
            .groupBy("o.id")
            .addGroupBy("a.user_wallet")
            .getRawMany();

        return rows.map((r) => ({
            ...r,
            rate: Number(r.rate),
            markets: r.markets ?? [],
        }));
    }

    /**
     * Loads a single order by ID with account wallet and market data.
     * Used by the WebSocket gateway when a status update arrives for an order not yet in memory.
     */
    async findOrderForTracking(
        orderId: string,
    ): Promise<OrderForTracking | null> {
        const rows = await this.createQueryBuilder("o")
            .select("o.id", "id")
            .addSelect("o.asset_id", "assetId")
            .addSelect("o.side", "side")
            .addSelect("o.type", "type")
            .addSelect("o.rate", "rate")
            .addSelect("o.quantity", "quantity")
            .addSelect("o.filled_quantity", "filledQuantity")
            .addSelect("o.settlement_fee", "settlementFee")
            .addSelect("o.account_id", "accountId")
            .addSelect("o.status", "status")
            .addSelect("a.user_wallet", "userWallet")
            .addSelect(
                `json_agg(json_build_object('marketId', om.market_id, 'maturity', COALESCE(EXTRACT(EPOCH FROM m.maturity)::int, 0))) FILTER (WHERE om.market_id IS NOT NULL)`,
                "markets",
            )
            .innerJoin("accounts", "a", "a.id = o.account_id")
            .leftJoin("order_markets", "om", "om.order_id = o.id")
            .leftJoin("markets", "m", "m.id = om.market_id")
            .where("o.id = :orderId", { orderId })
            .groupBy("o.id")
            .addGroupBy("a.user_wallet")
            .getRawMany();

        if (rows.length === 0) return null;

        const r = rows[0];
        return {
            ...r,
            rate: Number(r.rate),
            markets: r.markets ?? [],
        };
    }

    /**
     * Returns IDs of all active LIMIT orders for a given asset.
     * Used by the WebSocket gateway for phantom order cleanup.
     */
    async findActiveOrderIdsByAsset(assetId: string): Promise<string[]> {
        const rows = await this.createQueryBuilder("o")
            .select("o.id", "id")
            .where("o.asset_id = :assetId", { assetId })
            .andWhere("o.type = :type", { type: OrderType.Limit })
            .andWhere("o.status IN (:...statuses)", {
                statuses: [OrderStatus.Open, OrderStatus.PartiallyFilled],
            })
            .getRawMany();

        return rows.map((r) => r.id);
    }
}
