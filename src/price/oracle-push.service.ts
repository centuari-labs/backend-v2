import { Injectable, Logger } from "@nestjs/common";
import { parseUnits } from "viem";
import { PriceService } from "./price.service";
import { TokensRepository } from "../tokens/repositories/tokens.repository";
import { ChainConfigService } from "../core/chain-config/chain-config.service";
import { ViemService } from "../core/viem/viem.service";

// Minimal ABI — the keeper only ever calls setPrice (operator-gated).
const PUSH_ORACLE_ABI = [
    {
        type: "function",
        name: "setPrice",
        stateMutability: "nonpayable",
        inputs: [{ name: "price1e18", type: "uint256" }],
        outputs: [],
    },
] as const;

/**
 * Phase 3 price keeper. Pushes the latest CoinGecko USD price (already fetched
 * + cached by {@link PriceService}) to each token's on-chain `PushOracle` so the
 * `OracleRouter` stays fresh. If no one pushes, the router fail-closes past its
 * `maxStaleness` window and the real `RiskModule` blocks every collateral
 * withdraw / unflag-while-in-debt. Prices are operator-gated, so this runs with
 * `OPERATOR_PRIVATE_KEY` (the PushOracle operator).
 *
 * Self-disables when no operator key or no PushOracles are configured (e.g. a
 * stub-only deployment), so it is a no-op until the real oracle stack is live.
 */
@Injectable()
export class OraclePushService {
    private readonly logger = new Logger(OraclePushService.name);

    constructor(
        private readonly chainConfig: ChainConfigService,
        private readonly priceService: PriceService,
        private readonly tokensRepository: TokensRepository,
        private readonly viemService: ViemService,
    ) {}

    /**
     * Push the current cached USD price to every token that has a PushOracle.
     * Per-token failures (e.g. SC-2 deviation guard, RPC hiccup) are isolated so
     * one bad asset never blocks the rest; the next cycle retries.
     */
    async pushAllPrices(): Promise<void> {
        const operatorKey = this.chainConfig.oraclePushOperatorPrivateKey;
        const pushOracles = this.chainConfig.pushOracles;

        if (!operatorKey) {
            this.logger.debug(
                "No oracle-push operator key (ORACLE_PUSH_OPERATOR_PRIVATE_KEY / OPERATOR_PRIVATE_KEY); skipping oracle push",
            );
            return;
        }
        if (Object.keys(pushOracles).length === 0) {
            this.logger.debug(
                "No PushOracles configured (PUSH_ORACLES_JSON empty); skipping",
            );
            return;
        }
        if (!this.priceService.isCacheReady()) {
            this.logger.warn("Price cache not ready; skipping oracle push");
            return;
        }

        const tokens = await this.tokensRepository.getActiveTokens();
        const prices = this.priceService.getPrices();

        let pushed = 0;
        let skipped = 0;
        let failed = 0;

        for (const token of tokens) {
            const oracle = pushOracles[token.symbol];
            if (!oracle) continue; // no PushOracle registered for this token

            const price = prices[token.id.toLowerCase()];
            if (
                typeof price !== "number" ||
                !Number.isFinite(price) ||
                price <= 0
            ) {
                skipped++;
                continue;
            }

            // PushOracle prices are USD-per-whole-token scaled to 1e18 regardless
            // of token decimals; toFixed(18) avoids float exponent notation.
            let price1e18: bigint;
            try {
                price1e18 = parseUnits(price.toFixed(18), 18);
            } catch {
                skipped++;
                continue;
            }
            if (price1e18 <= 0n) {
                skipped++;
                continue;
            }

            try {
                const hash = await this.viemService.writeContract(
                    this.chainConfig.chainId,
                    operatorKey,
                    oracle,
                    PUSH_ORACLE_ABI,
                    "setPrice",
                    [price1e18],
                );
                pushed++;
                this.logger.debug(
                    `Pushed ${token.symbol}=$${price} -> ${oracle} (${String(hash)})`,
                );
            } catch (error) {
                failed++;
                this.logger.warn(
                    `Oracle push failed for ${token.symbol} (${oracle}): ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }

        this.logger.log(
            `Oracle push cycle complete: ${pushed} pushed, ${skipped} skipped, ${failed} failed`,
        );
    }
}
