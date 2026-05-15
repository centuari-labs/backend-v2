import { HttpException, Logger } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { applyOnChainEffect } from "@centuari-labs/on-chain-effects";
import type { TransactionReceipt } from "viem";
import { CollateralService } from "../../collateral/collateral.service";
import { ChainConfigService } from "../../core/chain-config/chain-config.service";
import { DatabaseService } from "../../core/database/database.service";
import { ViemService } from "../../core/viem/viem.service";
import { CollateralOnChainRepository } from "../../collateral/repositories/collateral-on-chain.repository";
import { PendingCollateralFlagsRepository } from "../../collateral/repositories/pending-collateral-flags.repository";
import { RedisRateLimiterService } from "../../common/rate-limit/redis-rate-limiter.service";
import { COLLATERAL_QUEUE_CAP_PER_WALLET } from "../../collateral/constants";

jest.mock("@centuari-labs/on-chain-effects");

const WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ASSET = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const TX_HASH =
    "0x1111111111111111111111111111111111111111111111111111111111111111";

describe("CollateralService", () => {
    let service: CollateralService;
    let pendingRepo: jest.Mocked<PendingCollateralFlagsRepository>;
    let onChainRepo: jest.Mocked<CollateralOnChainRepository>;
    let viemService: jest.Mocked<ViemService>;
    let rateLimiter: jest.Mocked<RedisRateLimiterService>;
    const applyMock = applyOnChainEffect as jest.MockedFunction<
        typeof applyOnChainEffect
    >;

    beforeAll(() => {
        jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
        jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
        jest.spyOn(Logger.prototype, "debug").mockImplementation(() => {});
    });

    beforeEach(async () => {
        jest.clearAllMocks();

        const mockViem: Partial<jest.Mocked<ViemService>> = {
            getPublicClient: jest.fn().mockReturnValue({} as never),
            readContract: jest.fn(),
            writeContract: jest.fn(),
        };
        const mockDb: Partial<jest.Mocked<DatabaseService>> = {
            getPool: jest.fn().mockReturnValue({} as never),
        };
        const mockChain: Partial<ChainConfigService> = {
            chainId: 421614,
            operatorPrivateKey: "0xkey",
            collateralManagerAddress: "0xCollateralManager",
            riskModuleAddress: "0xRiskModule",
        };
        const mockOnChain: Partial<jest.Mocked<CollateralOnChainRepository>> = {
            isAlreadyStamped: jest.fn(),
            upsertFlag: jest.fn(),
        };
        const mockPending: Partial<
            jest.Mocked<PendingCollateralFlagsRepository>
        > = {
            enqueue: jest.fn(),
            dequeue: jest.fn(),
            countForWallet: jest.fn(),
            readForWallet: jest.fn(),
        };
        const mockRateLimiter: Partial<jest.Mocked<RedisRateLimiterService>> = {
            consume: jest
                .fn()
                .mockResolvedValue({ allowed: true, remaining: 9 }),
        };

        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                CollateralService,
                { provide: ViemService, useValue: mockViem },
                { provide: DatabaseService, useValue: mockDb },
                { provide: ChainConfigService, useValue: mockChain },
                { provide: CollateralOnChainRepository, useValue: mockOnChain },
                {
                    provide: PendingCollateralFlagsRepository,
                    useValue: mockPending,
                },
                { provide: RedisRateLimiterService, useValue: mockRateLimiter },
            ],
        }).compile();

        service = moduleRef.get(CollateralService);
        pendingRepo = moduleRef.get(PendingCollateralFlagsRepository);
        onChainRepo = moduleRef.get(CollateralOnChainRepository);
        viemService = moduleRef.get(ViemService);
        rateLimiter = moduleRef.get(RedisRateLimiterService);
    });

    describe("flag", () => {
        it("queues the asset and never submits on-chain", async () => {
            pendingRepo.countForWallet.mockResolvedValue(0);
            pendingRepo.enqueue.mockResolvedValue();

            const result = await service.flag(WALLET, { asset: ASSET });

            expect(result).toEqual({ queued: true });
            expect(rateLimiter.consume).toHaveBeenCalledWith(
                `collateral:write:${WALLET.toLowerCase()}`,
                10,
                86_400,
            );
            expect(pendingRepo.countForWallet).toHaveBeenCalledWith(WALLET);
            expect(pendingRepo.enqueue).toHaveBeenCalledWith(WALLET, ASSET);
            expect(viemService.writeContract).not.toHaveBeenCalled();
            expect(applyMock).not.toHaveBeenCalled();
        });

        it("rejects with COLLATERAL_LIMIT_EXCEEDED at the cap", async () => {
            pendingRepo.countForWallet.mockResolvedValue(
                COLLATERAL_QUEUE_CAP_PER_WALLET,
            );

            await expect(
                service.flag(WALLET, { asset: ASSET }),
            ).rejects.toThrow(HttpException);
            expect(pendingRepo.enqueue).not.toHaveBeenCalled();
        });

        it("rejects with RATE_LIMITED when the limiter is exhausted", async () => {
            rateLimiter.consume.mockResolvedValue({
                allowed: false,
                remaining: 0,
                retryAfterSeconds: 3600,
            });

            await expect(
                service.flag(WALLET, { asset: ASSET }),
            ).rejects.toThrow(HttpException);
            expect(pendingRepo.countForWallet).not.toHaveBeenCalled();
            expect(pendingRepo.enqueue).not.toHaveBeenCalled();
        });
    });

    describe("unflag", () => {
        it("dequeues without on-chain action when the asset is queue-only", async () => {
            pendingRepo.dequeue.mockResolvedValue(true);

            const result = await service.unflag(WALLET, { asset: ASSET });

            expect(result).toEqual({ dequeued: true });
            expect(rateLimiter.consume).toHaveBeenCalled();
            expect(pendingRepo.dequeue).toHaveBeenCalledWith(WALLET, ASSET);
            expect(viemService.readContract).not.toHaveBeenCalled();
            expect(viemService.writeContract).not.toHaveBeenCalled();
        });

        it("short-circuits with WOULD_MAKE_UNHEALTHY when canUnflag returns false", async () => {
            pendingRepo.dequeue.mockResolvedValue(false);
            viemService.readContract.mockResolvedValue(false as never);

            await expect(
                service.unflag(WALLET, { asset: ASSET }),
            ).rejects.toThrow(HttpException);
            expect(viemService.readContract).toHaveBeenCalledWith(
                421614,
                "0xRiskModule",
                expect.any(Array),
                "canUnflag",
                [WALLET, ASSET],
            );
            expect(viemService.writeContract).not.toHaveBeenCalled();
        });

        it("submits unflagFor and stamps when canUnflag is true", async () => {
            pendingRepo.dequeue.mockResolvedValue(false);
            viemService.readContract.mockResolvedValue(true as never);
            const fakeReceipt = {
                transactionHash: TX_HASH,
                status: "success",
            } as unknown as TransactionReceipt;
            viemService.writeContract.mockResolvedValue(fakeReceipt);
            applyMock.mockResolvedValue({ applied: true });

            const result = await service.unflag(WALLET, { asset: ASSET });

            expect(result).toEqual({ applied: true, txHash: TX_HASH });
            expect(viemService.writeContract).toHaveBeenCalledWith(
                421614,
                "0xkey",
                "0xCollateralManager",
                expect.any(Array),
                "unflagFor",
                [WALLET, ASSET],
                { waitForReceipt: true },
            );
            const applyArgs = applyMock.mock.calls[0][0];
            expect(applyArgs.txHash).toBe(TX_HASH);
            expect(
                applyArgs.expectedArgsPredicate({
                    writer: "0x0",
                    user: WALLET,
                    asset: ASSET,
                    used: false,
                    flaggedAt: 0n,
                } as never),
            ).toBe(true);
            expect(
                applyArgs.expectedArgsPredicate({
                    writer: "0x0",
                    user: WALLET,
                    asset: ASSET,
                    used: true,
                    flaggedAt: 0n,
                } as never),
            ).toBe(false);
        });

        it("propagates non-applied apply-effect rejections as { applied: false, reason }", async () => {
            pendingRepo.dequeue.mockResolvedValue(false);
            viemService.readContract.mockResolvedValue(true as never);
            const fakeReceipt = {
                transactionHash: TX_HASH,
                status: "success",
            } as unknown as TransactionReceipt;
            viemService.writeContract.mockResolvedValue(fakeReceipt);
            applyMock.mockResolvedValue({
                applied: false,
                reason: "args_mismatch",
            });

            const result = await service.unflag(WALLET, { asset: ASSET });

            expect(result).toEqual({
                applied: false,
                reason: "args_mismatch",
            });
        });

        it("rejects with RATE_LIMITED when the limiter is exhausted", async () => {
            rateLimiter.consume.mockResolvedValue({
                allowed: false,
                remaining: 0,
                retryAfterSeconds: 1800,
            });

            await expect(
                service.unflag(WALLET, { asset: ASSET }),
            ).rejects.toThrow(HttpException);
            expect(pendingRepo.dequeue).not.toHaveBeenCalled();
            expect(viemService.readContract).not.toHaveBeenCalled();
            expect(viemService.writeContract).not.toHaveBeenCalled();
        });
    });

    it("repository wiring is intact", () => {
        expect(onChainRepo.upsertFlag).toBeDefined();
        expect(pendingRepo.enqueue).toBeDefined();
    });
});
