import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { MarketService } from '../../market/market.service';
import { Market } from '../../market/entities/market.entity';
import { TokensService } from '../../tokens/tokens.service';
import { CreateMarketDto } from '../../market/dto/market.dto';
import { Order } from '../../orders/entities/order.entity';
import { Portfolio } from '../../analytics/entities/portfolio.entity';
import { BorrowPosition } from '../../analytics/entities/borrow-position.entity';
import { Token } from '../../tokens/entities/token.entity';

describe('MarketService', () => {
    let service: MarketService;
    let marketRepository: jest.Mocked<Repository<Market>>;

    const mockAssetId = '550e8400-e29b-41d4-a716-446655440001';
    const mockMarketId = '660e8400-e29b-41d4-a716-446655440001';

    const createMockMarket = (overrides: Partial<Market> = {}): Market => ({
        id: mockMarketId,
        assetId: mockAssetId,
        maturity: new Date('2026-12-31T23:59:59.000Z'),
        createdAt: new Date(),
        asset: {
            id: mockAssetId,
            symbol: 'USDC',
            name: 'USD Coin',
            tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            isLoanToken: true,
            chainId: null,
            averageLTV: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
        ...overrides,
    });

    beforeEach(async () => {
        const mockMarketRepository = {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            createQueryBuilder: jest.fn(),
        };

        const mockTokensService = {
            validateTokenById: jest.fn(),
        };

        const mockOrderRepository = {
            createQueryBuilder: jest.fn(),
            find: jest.fn(),
        };

        const mockPortfolioRepository = {
            find: jest.fn(),
        };

        const mockBorrowPositionRepository = {
            find: jest.fn(),
        };

        const mockTokenRepository = {
            find: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MarketService,
                {
                    provide: getRepositoryToken(Market),
                    useValue: mockMarketRepository,
                },
                {
                    provide: getRepositoryToken(Order),
                    useValue: mockOrderRepository,
                },
                {
                    provide: getRepositoryToken(Portfolio),
                    useValue: mockPortfolioRepository,
                },
                {
                    provide: getRepositoryToken(BorrowPosition),
                    useValue: mockBorrowPositionRepository,
                },
                {
                    provide: getRepositoryToken(Token),
                    useValue: mockTokenRepository,
                },
                {
                    provide: TokensService,
                    useValue: mockTokensService,
                },
            ],
        }).compile();

        service = module.get<MarketService>(MarketService);
        marketRepository = module.get(getRepositoryToken(Market));
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('getMarkets', () => {
        it('should return all markets with asset details', async () => {
            const mockMarkets = [
                createMockMarket(),
                createMockMarket({
                    id: '660e8400-e29b-41d4-a716-446655440002',
                    assetId: '550e8400-e29b-41d4-a716-446655440002',
                }),
            ];

            const mockQueryBuilder = {
                leftJoinAndSelect: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue(mockMarkets),
            };

            marketRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

            const result = await service.getMarkets();

            expect(result).toHaveLength(2);
            expect(result[0]).toHaveProperty('asset');
            expect(result[0].asset!.symbol).toBe('USDC');
            expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('market.asset', 'asset');
        });

        it('should filter markets by assetId', async () => {
            const mockMarkets = [createMockMarket()];

            const mockQueryBuilder = {
                leftJoinAndSelect: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue(mockMarkets),
            };

            marketRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

            const result = await service.getMarkets(mockAssetId);

            expect(mockQueryBuilder.where).toHaveBeenCalledWith('market.assetId = :assetId', { assetId: mockAssetId });
            expect(result).toHaveLength(1);
            expect(result[0].assetId).toBe(mockAssetId);
        });

        it('should return empty array when no markets exist', async () => {
            const mockQueryBuilder = {
                leftJoinAndSelect: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([]),
            };

            marketRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

            const result = await service.getMarkets();

            expect(result).toEqual([]);
        });
    });

    describe('createMarket', () => {
        const createDto: CreateMarketDto = {
            assetId: mockAssetId,
        };

        it('should create a new market with maturity date', async () => {
            const expectedMarket = createMockMarket({
                maturity: new Date('2027-06-30T23:59:59.000Z'),
            });

            marketRepository.create.mockReturnValue(expectedMarket);
            marketRepository.save.mockResolvedValue(expectedMarket);
            marketRepository.findOne.mockResolvedValue(expectedMarket);

            const result = await service.createMarket(createDto);

            expect(result).toHaveProperty('id');
            expect(result.assetId).toBe(mockAssetId);
            expect(result.asset!.symbol).toBe('USDC');
        });

        it('should create a perpetual market without maturity', async () => {
            const dtoPerpetual: CreateMarketDto = {
                assetId: mockAssetId,
            };

            const expectedMarket = createMockMarket({
                maturity: undefined,
            });

            marketRepository.create.mockReturnValue(expectedMarket);
            marketRepository.save.mockResolvedValue(expectedMarket);
            marketRepository.findOne.mockResolvedValue(expectedMarket);

            const result = await service.createMarket(dtoPerpetual);

        });

        it('should validate asset exists before creating market', async () => {
            const expectedMarket = createMockMarket();

            marketRepository.create.mockReturnValue(expectedMarket);
            marketRepository.save.mockResolvedValue(expectedMarket);
            marketRepository.findOne.mockResolvedValue(expectedMarket);

            await service.createMarket(createDto);

        });

        it('should load asset relationship after creation', async () => {
            const expectedMarket = createMockMarket();

            marketRepository.create.mockReturnValue(expectedMarket);
            marketRepository.save.mockResolvedValue(expectedMarket);
            marketRepository.findOne.mockResolvedValue(expectedMarket);

            await service.createMarket(createDto);

            expect(marketRepository.findOne).toHaveBeenCalledWith({
                where: { id: expectedMarket.id },
                relations: ['asset'],
            });
        });

        it('should throw NotFoundException if market not found after creation', async () => {
            const expectedMarket = createMockMarket();

            marketRepository.create.mockReturnValue(expectedMarket);
            marketRepository.save.mockResolvedValue(expectedMarket);
            marketRepository.findOne.mockResolvedValue(null);

            await expect(
                service.createMarket(createDto)
            ).rejects.toThrow(NotFoundException);
        });

        it('should generate UUID for new market', async () => {
            const expectedMarket = createMockMarket();

            marketRepository.create.mockReturnValue(expectedMarket);
            marketRepository.save.mockResolvedValue(expectedMarket);
            marketRepository.findOne.mockResolvedValue(expectedMarket);

            await service.createMarket(createDto);

            expect(marketRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: expect.any(String),
                    assetId: mockAssetId,
                })
            );
        });
    });
});
