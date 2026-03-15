import { InjectRepository } from '@nestjs/typeorm';
import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { OrderMarket } from '../entities/order-market.entity';
import { OrderSide, OrderStatus } from '../constants/order.constants';
import { Account } from '../entities/account.entity';

@Injectable()
export class OrderRepository extends Repository<Order> {
    constructor(
        private dataSource: DataSource,
        @InjectRepository(Account) private accountRepository: Repository<Account>,
    ) {
        super(Order, dataSource.createEntityManager());
    }

    /**
     * Inserts one row into `orders` and one row per market into `order_markets` in a single transaction.
     */
    async saveOrderWithMarkets(order: Order, marketIds: string[]): Promise<Order> {
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

    async getOrCreateAccount(walletAddress: string, privyUserId: string): Promise<Account> {
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

    async getBestRates(): Promise<Map<string, { borrow: number; lend: number }>> {
        const rawResults = await this.createQueryBuilder('order')
            .select('order.assetId', 'assetId')
            .addSelect('MIN(NULLIF(CASE WHEN order.side = :borrowSide THEN order.rate ELSE NULL END, 0))', 'lowestBorrow')
            .addSelect('MAX(CASE WHEN order.side = :lendSide THEN order.rate ELSE 0 END)', 'highestLend')
            .where('order.status = :status', { status: OrderStatus.Open })
            .setParameters({ borrowSide: OrderSide.Borrow, lendSide: OrderSide.Lend })
            .groupBy('order.assetId')
            .getRawMany();

        const rateMap = new Map<string, { borrow: number; lend: number }>();
        for (const rate of rawResults) {
            rateMap.set(rate.assetId, {
                borrow: rate.lowestBorrow ? Number.parseFloat(rate.lowestBorrow) : 0,
                lend: rate.highestLend ? Number.parseFloat(rate.highestLend) : 0,
            });
        }
        return rateMap;
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
        return this.accountRepository.createQueryBuilder("account")
            .where("LOWER(account.user_wallet) = LOWER(:walletAddress)", { walletAddress })
            .getOne();
    }

    async getTotalOpenQuantity(accountId: string, assetId: string, side: OrderSide): Promise<bigint> {
        const result = await this.createQueryBuilder('order')
            .select('SUM(order.quantity - COALESCE(order.filled_quantity, 0))', 'total')
            .where('order.accountId = :accountId', { accountId })
            .andWhere('order.assetId = :assetId', { assetId })
            .andWhere('order.side = :side', { side })
            .andWhere('order.status IN (:...statuses)', {
                statuses: [OrderStatus.Open, OrderStatus.PartiallyFilled]
            })
            .getRawOne();

        if (!result || !result.total) {
            return 0n;
        }

        const totalStr = String(result.total).split('.')[0];
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
    ): Promise<boolean> {
        if (!marketIds.length) return false;

        const counterpartySide = side === OrderSide.Lend ? OrderSide.Borrow : OrderSide.Lend;

        const result = await this.createQueryBuilder('order')
            .innerJoin('order_markets', 'om', 'om.order_id = order.id')
            .where('order.assetId = :assetId', { assetId })
            .andWhere('order.side = :side', { side: counterpartySide })
            .andWhere('order.type = :type', { type: 'LIMIT' })
            .andWhere('order.status IN (:...statuses)', {
                statuses: [OrderStatus.Open, OrderStatus.PartiallyFilled],
            })
            .andWhere('om.market_id IN (:...marketIds)', { marketIds })
            .limit(1)
            .getCount();

        return result > 0;
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
            .addSelect("SUM(o.quantity::numeric - o.filled_quantity::numeric)", "lockedAmount")
            .where("o.account_id = :accountId", { accountId })
            .andWhere("o.side = :side", { side: OrderSide.Lend })
            .andWhere("o.status IN (:...statuses)", {
                statuses: [OrderStatus.Open, OrderStatus.PartiallyFilled],
            })
            .groupBy("o.assetId")
            .getRawMany();
    }
}