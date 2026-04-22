import { Injectable, Logger } from "@nestjs/common";
import { applyOnChainEffect } from "@centuari-labs/on-chain-effects";
import type { Hex } from "viem";
import { ChainConfigService } from "../core/chain-config/chain-config.service";
import { DatabaseService } from "../core/database/database.service";
import { ViemService } from "../core/viem/viem.service";
import {
    COLLATERAL_FLAG_SET_ABI,
    COLLATERAL_FLAG_SET_TOPIC0,
    type CollateralFlagSetArgs,
} from "./constants";
import type {
    CollateralMutationResponse,
    FlagCollateralDto,
    UnflagCollateralDto,
} from "./dto/collateral.dto";
import { CollateralOnChainRepository } from "./repositories/collateral-on-chain.repository";

@Injectable()
export class CollateralService {
    private readonly logger = new Logger(CollateralService.name);

    constructor(
        private readonly viemService: ViemService,
        private readonly databaseService: DatabaseService,
        private readonly chainConfig: ChainConfigService,
        private readonly repo: CollateralOnChainRepository,
    ) {}

    async flag(
        walletAddress: string,
        dto: FlagCollateralDto,
    ): Promise<CollateralMutationResponse> {
        return this.apply(walletAddress, dto, true);
    }

    async unflag(
        walletAddress: string,
        dto: UnflagCollateralDto,
    ): Promise<CollateralMutationResponse> {
        return this.apply(walletAddress, dto, false);
    }

    private async apply(
        walletAddress: string,
        dto: FlagCollateralDto,
        expectedUsed: boolean,
    ): Promise<CollateralMutationResponse> {
        const client = this.viemService.getPublicClient(
            this.chainConfig.chainId,
        );
        const pool = this.databaseService.getPool();
        const expectedUser = walletAddress.toLowerCase();
        const expectedAsset = dto.asset.toLowerCase();

        const result = await applyOnChainEffect<CollateralFlagSetArgs>({
            client,
            pool,
            txHash: dto.txHash as Hex,
            expectedEventTopic: COLLATERAL_FLAG_SET_TOPIC0,
            abi: COLLATERAL_FLAG_SET_ABI,
            expectedArgsPredicate: (args) =>
                args.user.toLowerCase() === expectedUser &&
                args.asset.toLowerCase() === expectedAsset &&
                args.used === expectedUsed,
            alreadyAppliedCheck: (tx, stamp) =>
                this.repo.isAlreadyStamped(
                    tx,
                    walletAddress,
                    dto.asset,
                    stamp.txHash,
                    stamp.logIndex,
                ),
            mutation: (tx, args, stamp) =>
                this.repo.upsertFlag(tx, args, stamp),
        });

        if (!result.applied && result.reason !== "already_stamped") {
            this.logger.warn(
                `collateral ${expectedUsed ? "flag" : "unflag"} rejected: ` +
                    `txHash=${dto.txHash} wallet=${walletAddress} reason=${result.reason}`,
            );
        }

        return result.applied
            ? { applied: true }
            : { applied: false, reason: result.reason };
    }
}
