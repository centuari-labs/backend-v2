import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { parseAbiItem, parseEventLogs, type Hash } from "viem";
import { ViemService } from "../core/viem/viem.service";
import { ChainConfigService } from "../core/chain-config/chain-config.service";
import { DatabaseService } from "../core/database/database.service";
import { PortfolioRepository } from "../portfolio/repositories/portfolio.repository";
import { portfolioUuidFor } from "../common/utils/uuid.utils";
import { Account } from "../orders/entities/account.entity";
import { Token } from "../tokens/entities/token.entity";
import { treasuryAbi } from "../abis/Treasury";

const STATE_KEY = "treasury-deposited";
const MAX_BLOCK_RANGE = 2000n;
const DEFAULT_POLL_INTERVAL_MS = 60_000;

const depositedEvent = parseAbiItem(
    "event Deposited(address indexed user, address indexed token, uint256 amount)",
);

@Injectable()
export class ChainIndexerService implements OnModuleInit {
    private readonly logger = new Logger(ChainIndexerService.name);
    private readonly startBlock: bigint;
    private readonly enabled: boolean;
    private polling = false;

    constructor(
        private readonly viemService: ViemService,
        private readonly databaseService: DatabaseService,
        private readonly portfolioRepository: PortfolioRepository,
        @InjectRepository(Account)
        private readonly accountRepository: Repository<Account>,
        @InjectRepository(Token)
        private readonly tokenRepository: Repository<Token>,
        private readonly configService: ConfigService,
        private readonly chainConfig: ChainConfigService,
    ) {
        this.startBlock = BigInt(
            this.configService.get<string>("INDEXER_START_BLOCK", "0"),
        );
        this.enabled =
            this.configService.get<string>("CHAIN_INDEXER_ENABLED", "true") ===
            "true";
    }

    async onModuleInit() {
        if (!this.enabled) {
            this.logger.log(
                "Chain indexer disabled via CHAIN_INDEXER_ENABLED=false",
            );
            return;
        }

        if (!this.chainConfig.treasuryAddress) {
            this.logger.warn(
                "TREASURY_ADDRESS not set — chain indexer disabled",
            );
            return;
        }

        await this.ensureStateRow();
        this.logger.log(
            `Chain indexer initialized for Treasury ${this.chainConfig.treasuryAddress} on chain ${this.chainConfig.chainId}`,
        );
    }

    /**
     * Fast path: process deposit events from a specific transaction hash.
     * Called by the deposit controller when the frontend sends a confirmed tx hash.
     * Returns the number of new deposits processed.
     */
    async processTransactionDeposits(txHash: string): Promise<number> {
        const receipt = await this.viemService.getTransactionReceipt(
            this.chainConfig.chainId,
            txHash as Hash,
        );

        if (receipt.status !== "success") {
            this.logger.warn(`Transaction ${txHash} reverted — skipping`);
            return 0;
        }

        const depositLogs = parseEventLogs({
            abi: treasuryAbi,
            eventName: "Deposited",
            logs: receipt.logs,
        }).filter(
            (log) =>
                log.address?.toLowerCase() ===
                this.chainConfig.treasuryAddress.toLowerCase(),
        );

        let processed = 0;

        for (const log of depositLogs) {
            const isNew = await this.markAsProcessed(txHash, log.logIndex);
            if (!isNew) continue;

            const didProcess = await this.processDepositArgs(
                (log.args as any).user as string,
                (log.args as any).token as string,
                (log.args as any).amount as bigint,
                txHash,
                log.logIndex,
            );
            if (didProcess) processed++;
        }

        return processed;
    }

    // ── Indexer polling (fallback) ──────────────────────────────────────

    @Interval(DEFAULT_POLL_INTERVAL_MS)
    async poll() {
        if (!this.enabled || !this.chainConfig.treasuryAddress || this.polling)
            return;

        this.polling = true;
        try {
            await this.pollDeposits();
        } catch (error) {
            this.logger.error(
                `Poll cycle failed: ${(error as Error).message}`,
                (error as Error).stack,
            );
        } finally {
            this.polling = false;
        }
    }

    private async pollDeposits() {
        const lastProcessedBlock = await this.getLastProcessedBlock();
        const publicClient = this.viemService.getPublicClient(
            this.chainConfig.chainId,
        );
        const currentBlock = await publicClient.getBlockNumber();

        if (currentBlock <= lastProcessedBlock) return;

        const fromBlock = lastProcessedBlock + 1n;
        const toBlock =
            currentBlock - fromBlock > MAX_BLOCK_RANGE
                ? fromBlock + MAX_BLOCK_RANGE
                : currentBlock;

        this.logger.debug(`Polling blocks ${fromBlock} → ${toBlock}`);

        const logs = await publicClient.getLogs({
            address: this.chainConfig.treasuryAddress as `0x${string}`,
            event: depositedEvent,
            fromBlock,
            toBlock,
        });

        if (logs.length > 0) {
            this.logger.log(
                `Found ${logs.length} Deposited event(s) in blocks ${fromBlock}–${toBlock}`,
            );
        }

        for (const log of logs) {
            const isNew = await this.markAsProcessed(
                log.transactionHash,
                log.logIndex,
            );
            if (!isNew) {
                this.logger.debug(
                    `Skipping already-processed deposit (tx: ${log.transactionHash}, logIndex: ${log.logIndex})`,
                );
                continue;
            }

            await this.processDepositArgs(
                log.args.user as string,
                log.args.token as string,
                log.args.amount as bigint,
                log.transactionHash,
                log.logIndex,
            );
        }

        await this.updateLastProcessedBlock(toBlock);
    }

    // ── Shared processing logic ────────────────────────────────────────

    /**
     * Attempts to insert into processed_tx_logs. Returns true if the row was
     * inserted (new event), false if it already existed (duplicate).
     */
    private async markAsProcessed(
        txHash: string,
        logIndex: number,
    ): Promise<boolean> {
        const result = await this.databaseService.query<{ tx_hash: string }>(
            `INSERT INTO processed_tx_logs (tx_hash, log_index, event_name)
             VALUES ($1, $2, 'Deposited')
             ON CONFLICT DO NOTHING
             RETURNING tx_hash`,
            [txHash.toLowerCase(), logIndex],
        );
        return result.length > 0;
    }

    private async processDepositArgs(
        user: string,
        token: string,
        amount: bigint,
        txHash: string,
        logIndex: number,
    ): Promise<boolean> {
        const userWallet = user.toLowerCase();
        const tokenAddress = token.toLowerCase();

        const account = await this.accountRepository
            .createQueryBuilder("account")
            .where("LOWER(account.user_wallet) = :wallet", {
                wallet: userWallet,
            })
            .getOne();

        if (!account) {
            this.logger.warn(
                `Deposited event skipped — no account for wallet ${userWallet} (tx: ${txHash})`,
            );
            return false;
        }

        const tokenEntity = await this.tokenRepository
            .createQueryBuilder("token")
            .where("LOWER(token.token_address) = :addr", { addr: tokenAddress })
            .getOne();

        if (!tokenEntity) {
            this.logger.warn(
                `Deposited event skipped — no asset for token ${tokenAddress} (tx: ${txHash})`,
            );
            return false;
        }

        const portfolioId = portfolioUuidFor(userWallet, tokenAddress);

        await this.portfolioRepository.upsertPortfolio(
            portfolioId,
            account.id,
            tokenEntity.id,
            amount.toString(),
        );

        this.logger.log(
            `Processed deposit: wallet=${userWallet} token=${tokenEntity.symbol} amount=${amount} (tx: ${txHash}, logIndex: ${logIndex})`,
        );
        return true;
    }

    // ── Indexer state management ───────────────────────────────────────

    private async ensureStateRow(): Promise<void> {
        const existing = await this.databaseService.queryOne<{ id: string }>(
            "SELECT id FROM indexer_state WHERE id = $1",
            [STATE_KEY],
        );

        if (!existing) {
            await this.databaseService.query(
                "INSERT INTO indexer_state (id, last_processed_block) VALUES ($1, $2)",
                [STATE_KEY, this.startBlock.toString()],
            );
            this.logger.log(
                `Initialized indexer state at block ${this.startBlock}`,
            );
        }
    }

    private async getLastProcessedBlock(): Promise<bigint> {
        const row = await this.databaseService.queryOne<{
            last_processed_block: string;
        }>("SELECT last_processed_block FROM indexer_state WHERE id = $1", [
            STATE_KEY,
        ]);
        return BigInt(row?.last_processed_block ?? "0");
    }

    private async updateLastProcessedBlock(block: bigint): Promise<void> {
        await this.databaseService.query(
            "UPDATE indexer_state SET last_processed_block = $1, updated_at = NOW() WHERE id = $2",
            [block.toString(), STATE_KEY],
        );
    }
}
