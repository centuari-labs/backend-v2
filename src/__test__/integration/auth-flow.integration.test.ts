// Mock privy modules to prevent jose ESM import chain
jest.mock('../../core/privy/privy.service', () => ({}));
jest.mock('../../common/guards/strategies/privy-auth.strategy', () => ({
    PrivyAuthStrategy: class MockPrivyAuthStrategy {
        async validate() { return { userId: 'mock', walletAddress: '0xMock' }; }
        getName() { return 'privy'; }
    },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AuthStrategyFactory } from '../../common/guards/strategies/auth-strategy.factory';
import { DevAuthStrategy } from '../../common/guards/strategies/dev-auth.strategy';
import { PrivyAuthStrategy } from '../../common/guards/strategies/privy-auth.strategy';
import type { AuthUser } from '../../common/guards/strategies/auth-strategy.interface';

/**
 * Integration tests for the auth flow:
 * AuthGuard → AuthStrategyFactory → DevAuthStrategy/PrivyAuthStrategy
 */
describe('Auth Flow Integration', () => {
    describe('DevAuthStrategy', () => {
        let strategy: DevAuthStrategy;

        beforeEach(() => {
            strategy = new DevAuthStrategy();
        });

        it('should validate DEV_TOKEN_ prefixed tokens', async () => {
            const result = await strategy.validate('DEV_TOKEN_0xMyWallet123');

            expect(result).toEqual({
                userId: 'dev-user-0xMyWallet123',
                walletAddress: '0xMyWallet123',
            });
        });

        it('should reject tokens without DEV_TOKEN_ prefix', async () => {
            await expect(strategy.validate('INVALID_TOKEN')).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it('should reject DEV_TOKEN_ with empty wallet', async () => {
            await expect(strategy.validate('DEV_TOKEN_')).rejects.toThrow(
                UnauthorizedException,
            );
        });

        it('should return correct strategy name', () => {
            expect(strategy.getName()).toBe('dev');
        });
    });

    describe('AuthGuard with DevAuthStrategy', () => {
        let guard: AuthGuard;

        function createMockContext(headers: Record<string, string> = {}): ExecutionContext {
            const request = {
                headers,
                user: undefined as AuthUser | undefined,
            };
            return {
                switchToHttp: () => ({
                    getRequest: () => request,
                }),
            } as unknown as ExecutionContext;
        }

        beforeEach(async () => {
            const originalEnv = process.env.AUTH_MODE;
            process.env.AUTH_MODE = 'development';

            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    AuthGuard,
                    AuthStrategyFactory,
                    DevAuthStrategy,
                    {
                        provide: PrivyAuthStrategy,
                        useValue: { validate: jest.fn(), getName: () => 'privy' },
                    },
                ],
            }).compile();

            guard = module.get<AuthGuard>(AuthGuard);

            process.env.AUTH_MODE = originalEnv;
        });

        it('should authenticate with valid dev token', async () => {
            const ctx = createMockContext({
                authorization: 'Bearer DEV_TOKEN_0xTestWallet',
            });

            const result = await guard.canActivate(ctx);

            expect(result).toBe(true);
            const request = ctx.switchToHttp().getRequest();
            expect(request.user).toEqual({
                userId: 'dev-user-0xTestWallet',
                walletAddress: '0xTestWallet',
            });
        });

        it('should reject missing authorization header', async () => {
            const ctx = createMockContext({});

            await expect(guard.canActivate(ctx)).rejects.toThrow(
                'Authorization header is required',
            );
        });

        it('should reject invalid authorization format', async () => {
            const ctx = createMockContext({
                authorization: 'Basic some-token',
            });

            await expect(guard.canActivate(ctx)).rejects.toThrow(
                'Invalid authorization header format',
            );
        });

        it('should reject missing token after Bearer', async () => {
            const ctx = createMockContext({
                authorization: 'Bearer ',
            });

            // "Bearer " splits into ["Bearer", ""], empty string is falsy
            await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
        });

        it('should reject invalid dev token format', async () => {
            const ctx = createMockContext({
                authorization: 'Bearer INVALID_TOKEN_FORMAT',
            });

            await expect(guard.canActivate(ctx)).rejects.toThrow(
                'Invalid or expired token',
            );
        });

        it('should set request.user with walletAddress for @Wallet decorator', async () => {
            const ctx = createMockContext({
                authorization: 'Bearer DEV_TOKEN_0xAbCdEf',
            });

            await guard.canActivate(ctx);

            const request = ctx.switchToHttp().getRequest();
            expect(request.user?.walletAddress).toBe('0xAbCdEf');
        });

        it('should set request.user with userId for @CurrentUser decorator', async () => {
            const ctx = createMockContext({
                authorization: 'Bearer DEV_TOKEN_0xAbCdEf',
            });

            await guard.canActivate(ctx);

            const request = ctx.switchToHttp().getRequest();
            expect(request.user?.userId).toBe('dev-user-0xAbCdEf');
        });
    });

    describe('AuthStrategyFactory', () => {
        it('should return DevAuthStrategy in development mode', () => {
            const originalEnv = process.env.AUTH_MODE;
            process.env.AUTH_MODE = 'development';

            const devStrategy = new DevAuthStrategy();
            const privyStrategy = { validate: jest.fn(), getName: () => 'privy' } as any;
            const factory = new AuthStrategyFactory(privyStrategy, devStrategy);

            expect(factory.getStrategy()).toBe(devStrategy);

            process.env.AUTH_MODE = originalEnv;
        });

        it('should return PrivyAuthStrategy in production mode', () => {
            const originalEnv = process.env.AUTH_MODE;
            process.env.AUTH_MODE = 'production';

            const devStrategy = new DevAuthStrategy();
            const privyStrategy = { validate: jest.fn(), getName: () => 'privy' } as any;
            const factory = new AuthStrategyFactory(privyStrategy, devStrategy);

            expect(factory.getStrategy()).toBe(privyStrategy);

            process.env.AUTH_MODE = originalEnv;
        });
    });
});
