import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { connect, type NatsConnection, type ConnectionOptions } from "nats";

@Injectable()
export class NatsService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(NatsService.name);
    private connection: NatsConnection | null = null;
    private readonly natsUrl: string;

    constructor() {
        this.natsUrl = process.env.NATS_URL || "nats://localhost:4222";
    }

    async onModuleInit() {
        await this.connect();
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
            };

            this.connection = await connect(options);
            this.logger.log(`Connected to NATS server at ${this.natsUrl}`);

            // Monitor connection status
            this.setupConnectionMonitoring();
        } catch (error) {
            this.logger.error(`Failed to connect to NATS server: ${error.message}`);
            throw error;
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
            this.logger.error(`Failed to publish to ${subject}: ${error.message}`);
            throw error;
        }
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
