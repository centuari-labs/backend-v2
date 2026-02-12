import { InjectRepository } from '@nestjs/typeorm';
import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { OrderSide, OrderStatus } from '../constants/order.constants';
import { Account } from '../entities/account.entity';
import { Token } from '../../tokens/entities/token.entity';

@Injectable()
export class OrderRepository extends Repository<Order> {
    constructor(
        private dataSource: DataSource,
        @InjectRepository(Account) private accountRepository: Repository<Account>,
        @InjectRepository(Token) private tokenRepository: Repository<Token>
    ) {
        super(Order, dataSource.createEntityManager());
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
            .addSelect('MAX(CASE WHEN order.side = :borrowSide THEN order.rate ELSE 0 END)', 'highestBid')
            .addSelect('MIN(NULLIF(CASE WHEN order.side = :lendSide THEN order.rate ELSE NULL END, 0))', 'lowestAsk')
            .where('order.status = :status', { status: OrderStatus.Open })
            .setParameters({ borrowSide: OrderSide.Borrow, lendSide: OrderSide.Lend })
            .groupBy('order.assetId')
            .getRawMany();

        const rateMap = new Map<string, { borrow: number; lend: number }>();
        for (const rate of rawResults) {
            rateMap.set(rate.assetId, {
                lend: rate.highestBid ? Number.parseFloat(rate.highestBid) : 0,
                borrow: rate.lowestAsk ? Number.parseFloat(rate.lowestAsk) : 0
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
        return this.accountRepository.findOne({
            where: { userWallet: walletAddress },
        });
    }

}
