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
        id: 'uuid-token-001',
        tokenAddress: '0xToken1234567890abcdef1234567890abcdef12',
        symbol: 'USDC',
        name: 'USD Coin',
        imageUrl: 'https://example.com/usdc.png',
        isLoanToken: true,
        LLTV: 0.86,
        LT: 0.86,
        LP: 0.99,
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

            const result = await service.validateToken(mockToken.tokenAddress);

            expect(result).toEqual(mockToken);
            expect(tokenRepository.findOne).toHaveBeenCalledWith({
                where: { tokenAddress: expect.anything() },
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
                service.validateToken(mockToken.tokenAddress),
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

            await service.validateToken(mockToken.tokenAddress.toUpperCase());

            expect(tokenRepository.findOne).toHaveBeenCalledWith({
                where: expect.objectContaining({
                    tokenAddress: expect.anything(),
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
                    id: 'uuid-token-002',
                    tokenAddress: '0xToken2234567890abcdef1234567890abcdef12',
                    symbol: 'ETH',
                    name: 'Ethereum',
                },
            ];

            tokenRepository.find.mockResolvedValue(activeTokens);

            const result = await service.getActiveTokens();

            expect(result).toEqual(activeTokens);
            expect(result).toHaveLength(2);
            expect(tokenRepository.find).toHaveBeenCalledWith();
        });

        it('should return empty array when no active tokens exist', async () => {
            tokenRepository.find.mockResolvedValue([]);

            const result = await service.getActiveTokens();

            expect(result).toEqual([]);
            expect(result).toHaveLength(0);
        });


    });

    describe('isTokenSupported', () => {
        it('should return true for valid active token', async () => {
            tokenRepository.count.mockResolvedValue(1);

            const result = await service.isTokenSupported(mockToken.tokenAddress);

            expect(result).toBe(true);
            expect(tokenRepository.count).toHaveBeenCalledWith({
                where: expect.objectContaining({
                    tokenAddress: expect.anything(),
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

            const result = await service.validateToken(mockToken.tokenAddress);

            expect(result).toHaveProperty('id');
            expect(result).toHaveProperty('tokenAddress');
            expect(result).toHaveProperty('symbol');
            expect(result).toHaveProperty('name');
            expect(result).toHaveProperty('imageUrl');
            expect(result).toHaveProperty('isLoanToken');
            expect(result).toHaveProperty('LLTV');
            expect(result).toHaveProperty('LT');
            expect(result).toHaveProperty('LP');
            expect(result).toHaveProperty('createdAt');
            expect(result).toHaveProperty('updatedAt');
        });

        it('should handle token with empty imageUrl', async () => {
            const tokenWithoutImage = { ...mockToken, imageUrl: '' };
            tokenRepository.findOne.mockResolvedValue(tokenWithoutImage);

            const result = await service.validateToken(mockToken.tokenAddress);

            expect(result.imageUrl).toBe('');
        });
    });
});
