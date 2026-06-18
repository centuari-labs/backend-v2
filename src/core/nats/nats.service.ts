import {
    Injectable,
    OnModuleInit,
    OnModuleDestroy,
    Logger,
} from "@nestjs/common";
import { connect, type NatsConnection, type ConnectionOptions } from "nats";

@Injectable()
export class NatsService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(NatsService.name);
    private connection: NatsConnection | null = null;
    private readonly natsUrl: string;
    private readonly natsUser?: string;
    private readonly natsPass?: string;
    private readonly natsToken?: string;

    constructor() {
        this.natsUrl = process.env.NATS_URL || "nats://localhost:4222";
        this.natsUser = process.env.NATS_USER || undefined;
        this.natsPass = process.env.NATS_PASS || undefined;
        this.natsToken = process.env.NATS_TOKEN || undefined;
        this.assertCredentials();
    }

    async onModuleInit() {
        await this.connect();
    }

    /**
     * Fail closed when NATS auth is required but no credentials are configured.
     * Opt in with `NATS_REQUIRE_AUTH=true` (recommended in production) — a
     * misconfigured deploy then crashes at boot instead of silently connecting
     * to an unauthenticated broker that any client on the network could publish
     * forged order/match messages to.
     */
    private assertCredentials(): void {
        const requireAuth =
            (process.env.NATS_REQUIRE_AUTH ?? "false").toLowerCase() === "true";
        const hasCredentials =
            Boolean(this.natsToken) ||
            (Boolean(this.natsUser) && Boolean(this.natsPass));

        if (requireAuth && !hasCredentials) {
            throw new Error(
                "[nats] NATS_REQUIRE_AUTH=true but no credentials configured. " +
                    "Set NATS_TOKEN, or NATS_USER and NATS_PASS.",
            );
        }
        if (!hasCredentials) {
            this.logger.warn(
                "NATS credentials not configured — connecting unauthenticated. " +
                    "Set NATS_TOKEN or NATS_USER/NATS_PASS (and NATS_REQUIRE_AUTH=true) in production.",
            );
        }
    }

    async onModuleDestroy() {
        await this.disconnect();
    }

    private async connect(): Promise<void> {
        try {
            const options: ConnectionOptions = {
                servers: this.natsUrl,
                maxReconnectAttempts: -1,
                reconnectTimeWait: 1000,
                name: "centuari-backend",
                ...(this.natsToken ? { token: this.natsToken } : {}),
                ...(this.natsUser && this.natsPass
                    ? { user: this.natsUser, pass: this.natsPass }
                    : {}),
            };

            this.connection = await connect(options);
            this.logger.log(`Connected to NATS server at ${this.natsUrl}`);

            // Monitor connection status
            this.setupConnectionMonitoring();
        } catch (error) {
            this.logger.error(
                `Failed to connect to NATS server: ${error.message}. Retrying...`,
            );
            setTimeout(() => this.connect(), 1000);
        }
    }

    private setupConnectionMonitoring(): void {
        if (!this.connection) return;

        const connection = this.connection;
        (async () => {
            for await (const status of connection.status()) {
                this.logger.log(`NATS Status: ${status.type}`);
            }
        })();
    }

    async disconnect(): Promise<void> {
        if (this.connection) {
            await this.connection.drain();
            this.logger.log("Disconnected from NATS server");
            this.connection = null;
        }
    }

    // Publish a message to a NATS subject
    async publish(subject: string, data: unknown): Promise<void> {
        if (!this.connection) {
            throw new Error("NATS connection not established");
        }

        try {
            const payload = JSON.stringify(data);
            this.connection.publish(subject, new TextEncoder().encode(payload));
            this.logger.debug(`Published to ${subject}: ${payload}`);
        } catch (error) {
            this.logger.error(
                `Failed to publish to ${subject}: ${error.message}`,
            );
            throw error;
        }
    }

    // Send a request and await the responder's reply (request/reply).
    // Rejects if no reply arrives within `timeoutMs` (NATS TIMEOUT error).
    async request<T>(
        subject: string,
        data: unknown,
        timeoutMs: number,
    ): Promise<T> {
        if (!this.connection) {
            throw new Error("NATS connection not established");
        }

        const payload = JSON.stringify(data);
        const reply = await this.connection.request(
            subject,
            new TextEncoder().encode(payload),
            { timeout: timeoutMs },
        );
        return JSON.parse(new TextDecoder().decode(reply.data)) as T;
    }

    // Subscribe to a NATS subject
    async subscribe<T>(
        subject: string,
        callback: (data: T, subject: string) => void | Promise<void>,
    ): Promise<void> {
        if (!this.connection) {
            throw new Error("NATS connection not established");
        }

        const sub = this.connection.subscribe(subject);

        (async () => {
            for await (const msg of sub) {
                try {
                    const data = JSON.parse(
                        new TextDecoder().decode(msg.data),
                    ) as T;
                    await callback(data, msg.subject);
                } catch (error) {
                    this.logger.error(
                        `Error processing message from ${subject}: ${error.message}`,
                    );
                }
            }
        })();

        this.logger.log(`Subscribed to ${subject}`);
    }

    //  Check if connected to NATS
    isConnected(): boolean {
        return this.connection !== null && !this.connection.isClosed();
    }

    //  Get the NATS connection (for advanced usage)
    getConnection(): NatsConnection | null {
        return this.connection;
    }
}
