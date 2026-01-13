import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { Repository, ILike } from 'typeorm';
import { TokensService } from '../../tokens/tokens.service';
import { Token } from '../../tokens/entities/token.entity';

describe('TokensService', () => {
    let service: TokensService;
    let tokenRepository: jest.Mocked<Repository<Token>>;

    const mockToken: Token = {
        id: 1,
        address: '0xToken1234567890abcdef1234567890abcdef12',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        imageUrl: 'https://example.com/usdc.png',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(async () => {
        const mockTokenRepository = {
            findOne: jest.fn(),
            find: jest.fn(),
            count: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TokensService,
                {
                    provide: getRepositoryToken(Token),
                    useValue: mockTokenRepository,
                },
            ],
        }).compile();

        service = module.get<TokensService>(TokensService);
        tokenRepository = module.get(getRepositoryToken(Token));
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('validateToken', () => {
        it('should return token for valid active address', async () => {
            tokenRepository.findOne.mockResolvedValue(mockToken);

            const result = await service.validateToken(mockToken.address);

            expect(result).toEqual(mockToken);
            expect(tokenRepository.findOne).toHaveBeenCalledWith({
                where: { address: expect.anything(), isActive: true },
            });
        });

        it('should throw BadRequestException for unknown token address', async () => {
            tokenRepository.findOne.mockResolvedValue(null);

            await expect(
                service.validateToken('0xUnknownToken12345678901234567890123456'),
            ).rejects.toThrow(BadRequestException);
        });

        it('should throw BadRequestException for inactive token', async () => {
            tokenRepository.findOne.mockResolvedValue(null); // Inactive tokens are filtered out by query

            await expect(
                service.validateToken(mockToken.address),
            ).rejects.toThrow(BadRequestException);
        });

        it('should include error message with token address', async () => {
            const unknownAddress = '0xUnknownToken12345678901234567890123456';
            tokenRepository.findOne.mockResolvedValue(null);

            await expect(service.validateToken(unknownAddress)).rejects.toThrow(
                `Token ${unknownAddress} is not supported`,
            );
        });

        it('should perform case-insensitive address lookup', async () => {
            tokenRepository.findOne.mockResolvedValue(mockToken);

            await service.validateToken(mockToken.address.toUpperCase());

            expect(tokenRepository.findOne).toHaveBeenCalledWith({
                where: expect.objectContaining({
                    isActive: true,
                }),
            });
        });
    });

    describe('getActiveTokens', () => {
        it('should return all active tokens', async () => {
            const activeTokens: Token[] = [
                mockToken,
                {
                    ...mockToken,
                    id: 2,
                    address: '0xToken2234567890abcdef1234567890abcdef12',
                    symbol: 'ETH',
                    name: 'Ethereum',
                    decimals: 18,
                },
            ];

            tokenRepository.find.mockResolvedValue(activeTokens);

            const result = await service.getActiveTokens();

            expect(result).toEqual(activeTokens);
            expect(result).toHaveLength(2);
            expect(tokenRepository.find).toHaveBeenCalledWith({
                where: { isActive: true },
            });
        });

        it('should return empty array when no active tokens exist', async () => {
            tokenRepository.find.mockResolvedValue([]);

            const result = await service.getActiveTokens();

            expect(result).toEqual([]);
            expect(result).toHaveLength(0);
        });

        it('should not return inactive tokens', async () => {
            tokenRepository.find.mockResolvedValue([mockToken]);

            const result = await service.getActiveTokens();

            expect(result.every(token => token.isActive)).toBe(true);
        });
    });

    describe('isTokenSupported', () => {
        it('should return true for valid active token', async () => {
            tokenRepository.count.mockResolvedValue(1);

            const result = await service.isTokenSupported(mockToken.address);

            expect(result).toBe(true);
            expect(tokenRepository.count).toHaveBeenCalledWith({
                where: expect.objectContaining({
                    isActive: true,
                }),
            });
        });

        it('should return false for unknown token', async () => {
            tokenRepository.count.mockResolvedValue(0);

            const result = await service.isTokenSupported(
                '0xUnknownToken12345678901234567890123456',
            );

            expect(result).toBe(false);
        });

        it('should return false for inactive token', async () => {
            tokenRepository.count.mockResolvedValue(0);

            const result = await service.isTokenSupported(mockToken.address);

            expect(result).toBe(false);
        });

        it('should not throw for invalid token (returns boolean)', async () => {
            tokenRepository.count.mockResolvedValue(0);

            await expect(
                service.isTokenSupported('invalid-address'),
            ).resolves.toBe(false);
        });
    });

    describe('token data integrity', () => {
        it('should return complete token data with all fields', async () => {
            tokenRepository.findOne.mockResolvedValue(mockToken);

            const result = await service.validateToken(mockToken.address);

            expect(result).toHaveProperty('id');
            expect(result).toHaveProperty('address');
            expect(result).toHaveProperty('symbol');
            expect(result).toHaveProperty('name');
            expect(result).toHaveProperty('decimals');
            expect(result).toHaveProperty('imageUrl');
            expect(result).toHaveProperty('isActive');
            expect(result).toHaveProperty('createdAt');
            expect(result).toHaveProperty('updatedAt');
        });

        it('should handle token with null imageUrl', async () => {
            const tokenWithoutImage = { ...mockToken, imageUrl: null };
            tokenRepository.findOne.mockResolvedValue(tokenWithoutImage);

            const result = await service.validateToken(mockToken.address);

            expect(result.imageUrl).toBeNull();
        });
    });
});
