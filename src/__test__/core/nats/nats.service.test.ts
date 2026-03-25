jest.mock("nats", () => ({
    connect: jest.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { NatsService } from "../../../core/nats/nats.service";

describe("NatsService", () => {
    let service: NatsService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [NatsService],
        }).compile();

        service = module.get<NatsService>(NatsService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("publish", () => {
        it("should throw when no connection is established", async () => {
            await expect(
                service.publish("test.subject", { data: "test" }),
            ).rejects.toThrow("NATS connection not established");
        });

        it("should publish encoded message when connected", async () => {
            const mockPublish = jest.fn();
            const mockConnection = {
                publish: mockPublish,
                status: jest.fn().mockReturnValue({
                    [Symbol.asyncIterator]: () => ({
                        next: () => new Promise(() => {}),
                    }),
                }),
                isClosed: () => false,
            };

            // Manually set the connection
            (service as any).connection = mockConnection;

            await service.publish("test.subject", { key: "value" });

            expect(mockPublish).toHaveBeenCalledWith(
                "test.subject",
                expect.any(Uint8Array),
            );
        });

        it("should serialize data as JSON before publishing", async () => {
            const mockPublish = jest.fn();
            const mockConnection = {
                publish: mockPublish,
                isClosed: () => false,
            };

            (service as any).connection = mockConnection;

            const data = { event: "test", timestamp: "2026-01-01" };
            await service.publish("subject", data);

            const publishedPayload = new TextDecoder().decode(
                mockPublish.mock.calls[0][1],
            );
            expect(JSON.parse(publishedPayload)).toEqual(data);
        });

        it("should propagate errors from publish", async () => {
            const mockPublish = jest.fn().mockImplementation(() => {
                throw new Error("Publish failed");
            });
            const mockConnection = {
                publish: mockPublish,
                isClosed: () => false,
            };

            (service as any).connection = mockConnection;

            await expect(
                service.publish("subject", { data: "test" }),
            ).rejects.toThrow("Publish failed");
        });
    });

    describe("subscribe", () => {
        it("should throw when no connection is established", async () => {
            await expect(
                service.subscribe("test.subject", jest.fn()),
            ).rejects.toThrow("NATS connection not established");
        });

        it("should create subscription when connected", async () => {
            const mockSubscribe = jest.fn().mockReturnValue({
                [Symbol.asyncIterator]: () => ({
                    next: () => new Promise(() => {}),
                }),
            });
            const mockConnection = {
                subscribe: mockSubscribe,
                isClosed: () => false,
            };

            (service as any).connection = mockConnection;

            await service.subscribe("test.subject", jest.fn());

            expect(mockSubscribe).toHaveBeenCalledWith("test.subject");
        });
    });

    describe("isConnected", () => {
        it("should return false when no connection", () => {
            expect(service.isConnected()).toBe(false);
        });

        it("should return true when connection is open", () => {
            (service as any).connection = { isClosed: () => false };
            expect(service.isConnected()).toBe(true);
        });

        it("should return false when connection is closed", () => {
            (service as any).connection = { isClosed: () => true };
            expect(service.isConnected()).toBe(false);
        });
    });

    describe("disconnect", () => {
        it("should drain and nullify connection", async () => {
            const mockDrain = jest.fn().mockResolvedValue(undefined);
            (service as any).connection = { drain: mockDrain };

            await service.disconnect();

            expect(mockDrain).toHaveBeenCalled();
            expect((service as any).connection).toBeNull();
        });

        it("should do nothing when no connection", async () => {
            await expect(service.disconnect()).resolves.not.toThrow();
        });
    });

    describe("getConnection", () => {
        it("should return null when not connected", () => {
            expect(service.getConnection()).toBeNull();
        });

        it("should return connection when connected", () => {
            const mockConn = { isClosed: () => false };
            (service as any).connection = mockConn;
            expect(service.getConnection()).toBe(mockConn);
        });
    });
});
