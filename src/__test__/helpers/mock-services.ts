import type { OrderRepository } from '../../orders/repositories/order.repository';
import type { NatsService } from '../../core/nats/nats.service';
import type { EventsGateway } from '../../core/websocket/websocket.gateway';
import type { TokensService } from '../../tokens/tokens.service';
import type { PriceService } from '../../price/price.service';
import type { MarketRepositories } from '../../market/repository/market.repository';
import type { PortfolioService } from '../../portfolio/portfolio.service';
import type { OrdersService } from '../../orders/orders.service';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';

export function createMockOrderRepository(): Partial<jest.Mocked<OrderRepository>> {
    return {
        create: jest.fn(),
        save: jest.fn(),
        find: jest.fn(),
        findOne: jest.fn(),
        count: jest.fn(),
        saveOrderWithMarkets: jest.fn(),
        getOrCreateAccount: jest.fn(),
        getBestRates: jest.fn(),
        getOpenOrders: jest.fn(),
        findAccountByWallet: jest.fn(),
        createQueryBuilder: jest.fn(),
    };
}

export function createMockNatsService(): Partial<jest.Mocked<NatsService>> {
    return {
        publish: jest.fn().mockResolvedValue(undefined),
        subscribe: jest.fn().mockResolvedValue(undefined),
        isConnected: jest.fn().mockReturnValue(true),
    };
}

export function createMockEventsGateway(): Partial<jest.Mocked<EventsGateway>> {
    return {
        handleMatchCreated: jest.fn(),
    };
}

export function createMockTokensService(): Partial<jest.Mocked<TokensService>> {
    return {
        validateTokenByAssetId: jest.fn().mockResolvedValue(undefined),
        getTokenDecimalsByAssetId: jest.fn().mockResolvedValue(6),
        getTokenByAssetId: jest.fn(),
    } as any;
}

export function createMockPriceService(): Partial<jest.Mocked<PriceService>> {
    return {
        getPrice: jest.fn().mockResolvedValue(1),
    } as any;
}

export function createMockMarketRepository(): Partial<jest.Mocked<MarketRepositories>> {
    return {
        getMarketsByIds: jest.fn().mockResolvedValue([]),
    } as any;
}

export function createMockPortfolioService(): Partial<jest.Mocked<PortfolioService>> {
    return {
        getHealthFactorForAccount: jest.fn().mockResolvedValue({ healthFactor: 2 }),
    } as any;
}

export function createMockOrdersService(): Partial<jest.Mocked<OrdersService>> {
    return {
        createLendLimitOrder: jest.fn(),
        createLendMarketOrder: jest.fn(),
        createBorrowLimitOrder: jest.fn(),
        createBorrowMarketOrder: jest.fn(),
        cancelOrder: jest.fn(),
    } as any;
}

export function createMockRepository<T extends ObjectLiteral>(): Partial<jest.Mocked<Repository<T>>> {
    return {
        find: jest.fn(),
        findOne: jest.fn(),
        save: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
        createQueryBuilder: jest.fn(),
    } as any;
}

export function createMockDataSource(): Partial<jest.Mocked<DataSource>> {
    return {
        transaction: jest.fn(),
        createQueryBuilder: jest.fn(),
        createEntityManager: jest.fn(),
    } as any;
}
