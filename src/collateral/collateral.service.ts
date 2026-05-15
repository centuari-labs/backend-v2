import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { applyOnChainEffect } from "@centuari-labs/on-chain-effects";
import {
    type Abi,
    type Hex,
    type TransactionReceipt,
    BaseError,
    ContractFunctionRevertedError,
} from "viem";
import { ChainConfigService } from "../core/chain-config/chain-config.service";
import { DatabaseService } from "../core/database/database.service";
import { ViemService } from "../core/viem/viem.service";
import { RedisRateLimiterService } from "../common/rate-limit/redis-rate-limiter.service";
import CollateralManagerAbiJson from "../abi/CollateralManager.json";
import {
    COLLATERAL_FLAG_SET_ABI,
    COLLATERAL_FLAG_SET_TOPIC0,
    COLLATERAL_QUEUE_CAP_PER_WALLET,
    type CollateralFlagSetArgs,
    RATE_LIMIT_BUDGET,
    RATE_LIMIT_WINDOW_SECONDS,
    RISK_MODULE_VIEW_ABI,
} from "./constants";

const CollateralManagerAbi = CollateralManagerAbiJson as Abi;
import type {
    CollateralMutationResponse,
    FlagCollateralDto,
    UnflagCollateralDto,
} from "./dto/collateral.dto";
import { CollateralOnChainRepository } from "./repositories/collateral-on-chain.repository";
import { PendingCollateralFlagsRepository } from "./repositories/pending-collateral-flags.repository";

@Injectable()
export class CollateralService {
    private readonly logger = new Logger(CollateralService.name);

    constructor(
        private readonly viemService: ViemService,
        private readonly databaseService: DatabaseService,
        private readonly chainConfig: ChainConfigService,
        private readonly repo: CollateralOnChainRepository,
        private readonly pendingRepo: PendingCollateralFlagsRepository,
        private readonly rateLimiter: RedisRateLimiterService,
    ) {}

    /**
     * Queue-only flag. Never submits on-chain — frontend uses wagmi against
     * `CollateralManager.flag(asset)` for the immediate / emergency path
     * (Phase 5). Settlement-engine reads the queue at settle time and
     * encodes assets into `MatchData.collateralAssets`.
     */
    async flag(
        walletAddress: string,
        dto: FlagCollateralDto,
    ): Promise<CollateralMutationResponse> {
        await this.consumeRateLimit(walletAddress);

        const count = await this.pendingRepo.countForWallet(walletAddress);
        if (count >= COLLATERAL_QUEUE_CAP_PER_WALLET) {
            throw new HttpException(
                {
                    code: "COLLATERAL_LIMIT_EXCEEDED",
                    currentCount: count,
                    cap: COLLATERAL_QUEUE_CAP_PER_WALLET,
                },
                HttpStatus.BAD_REQUEST,
            );
        }

        await this.pendingRepo.enqueue(walletAddress, dto.asset);
        return { queued: true };
    }

    /**
     * Two-path unflag:
     *   1. Dequeue if the asset is only in the queue (no on-chain state to
     *      mutate). Returns `{ dequeued: true }`.
     *   2. Otherwise pre-check `RiskModule.canUnflag` via `readContract`. If
     *      the policy rejects, return 409 immediately without spending any
     *      gas. If it allows, submit `CollateralManager.unflagFor` via the
     *      operator key and stamp the result via `applyOnChainEffect`.
     */
    async unflag(
        walletAddress: string,
        dto: UnflagCollateralDto,
    ): Promise<CollateralMutationResponse> {
        await this.consumeRateLimit(walletAddress);

        if (await this.pendingRepo.dequeue(walletAddress, dto.asset)) {
            return { dequeued: true };
        }

        const canUnflag = await this.viemService.readContract<boolean>(
            this.chainConfig.chainId,
            this.chainConfig.riskModuleAddress,
            RISK_MODULE_VIEW_ABI,
            "canUnflag",
            [walletAddress, dto.asset],
        );
        if (!canUnflag) {
            throw new HttpException(
                { code: "WOULD_MAKE_UNHEALTHY" },
                HttpStatus.CONFLICT,
            );
        }

        return this.submitUnflagAndStamp(walletAddress, dto.asset);
    }

    private async consumeRateLimit(walletAddress: string): Promise<void> {
        const result = await this.rateLimiter.consume(
            `collateral:write:${walletAddress.toLowerCase()}`,
            RATE_LIMIT_BUDGET,
            RATE_LIMIT_WINDOW_SECONDS,
        );
        if (!result.allowed) {
            throw new HttpException(
                {
                    code: "RATE_LIMITED",
                    retryAfterSeconds: result.retryAfterSeconds,
                },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
    }

    private async submitUnflagAndStamp(
        walletAddress: string,
        asset: string,
    ): Promise<CollateralMutationResponse> {
        let receipt: TransactionReceipt;
        try {
            receipt = (await this.viemService.writeContract(
                this.chainConfig.chainId,
                this.chainConfig.operatorPrivateKey,
                this.chainConfig.collateralManagerAddress,
                CollateralManagerAbi,
                "unflagFor",
                [walletAddress, asset],
                { waitForReceipt: true },
            )) as TransactionReceipt;
        } catch (err) {
            const decoded = decodeKnownRevert(err);
            if (decoded) {
                throw new HttpException(decoded, HttpStatus.CONFLICT);
            }
            throw err;
        }

        const expectedUser = walletAddress.toLowerCase();
        const expectedAsset = asset.toLowerCase();
        const result = await applyOnChainEffect<CollateralFlagSetArgs>({
            client: this.viemService.getPublicClient(this.chainConfig.chainId),
            pool: this.databaseService.getPool(),
            txHash: receipt.transactionHash as Hex,
            expectedEventTopic: COLLATERAL_FLAG_SET_TOPIC0,
            abi: COLLATERAL_FLAG_SET_ABI,
            expectedArgsPredicate: (args) =>
                args.user.toLowerCase() === expectedUser &&
                args.asset.toLowerCase() === expectedAsset &&
                args.used === false,
            alreadyAppliedCheck: (tx, stamp) =>
                this.repo.isAlreadyStamped(
                    tx,
                    walletAddress,
                    asset,
                    stamp.txHash,
                    stamp.logIndex,
                ),
            mutation: (tx, args, stamp) =>
                this.repo.upsertFlag(tx, args, stamp),
        });

        if (!result.applied && result.reason !== "already_stamped") {
            this.logger.warn(
                `unflag effect rejected: txHash=${receipt.transactionHash} ` +
                    `wallet=${walletAddress} asset=${asset} reason=${result.reason}`,
            );
        }

        return result.applied
            ? { applied: true, txHash: receipt.transactionHash }
            : { applied: false, reason: result.reason };
    }
}

interface DecodedRevert {
    code: string;
    unlocksAt?: string;
}

/**
 * Walks a viem error chain looking for a `ContractFunctionRevertedError` and
 * matches the recognized custom errors (`FlagLockActive`, `WouldMakeUnhealthy`,
 * `NotFlagged`). Returns a structured payload for HttpException, or null if
 * the error isn't a known revert.
 */
function decodeKnownRevert(err: unknown): DecodedRevert | null {
    if (!(err instanceof BaseError)) return null;
    const reverted = err.walk(
        (e) => e instanceof ContractFunctionRevertedError,
    ) as ContractFunctionRevertedError | undefined;
    if (!reverted) return null;

    const errName = reverted.data?.errorName ?? reverted.reason;
    if (errName === "FlagLockActive") {
        const unlocksAt = reverted.data?.args?.[0];
        return {
            code: "FlagLockActive",
            unlocksAt: unlocksAt !== undefined ? String(unlocksAt) : undefined,
        };
    }
    if (errName === "WouldMakeUnhealthy") {
        return { code: "WOULD_MAKE_UNHEALTHY" };
    }
    if (errName === "NotFlagged") {
        return { code: "NOT_FLAGGED" };
    }
    return null;
}
