import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { OrderSide, OrderStatus } from '../constants/order.constants';

@Injectable()
export class OrderRepository extends Repository<Order> {
    constructor(private dataSource: DataSource) {
        super(Order, dataSource.createEntityManager());
    }

    async getBestRates(): Promise<Array<{ assetId: string, highestBid: string, lowestAsk: string }>> {
        return this.createQueryBuilder('order')
            .select('order.assetId', 'assetId')
            .addSelect('MAX(CASE WHEN order.side = :borrowSide THEN order.rate ELSE 0 END)', 'highestBid')
            .addSelect('MIN(NULLIF(CASE WHEN order.side = :lendSide THEN order.rate ELSE NULL END, 0))', 'lowestAsk')
            .where('order.status = :status', { status: OrderStatus.Open })
            .setParameters({ borrowSide: OrderSide.Borrow, lendSide: OrderSide.Lend })
            .groupBy('order.assetId')
            .getRawMany();
    }
}
