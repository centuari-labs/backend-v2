import { NatsService } from "../../../core/nats/nats.service";

// Mock the nats module
jest.mock("nats", () => ({
    connect: jest.fn(),
}));

import { connect } from "nats";

const mockConnect = connect as jest.Mock;

describe("NatsService", () => {
    let service: NatsService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new NatsService();
    });

    describe("publish", () => {
        it("should throw when not connected", async () => {
            await expect(
                service.publish("test.subject", { data: "hello" }),
            ).rejects.toThrow("NATS connection not established");
        });

        it("should publish encoded JSON when connected", async () => {
            const mockPublish = jest.fn();
            const mockConnection = {
                publish: mockPublish,
                drain: jest.fn(),
                isClosed: jest.fn().mockReturnValue(false),
                status: jest
                    .fn()
                    .mockReturnValue({
                        [Symbol.asyncIterator]: () => ({
                            next: () => new Promise(() => {}),
                        }),
                    }),
            };

            // Inject mock connection
            (service as any).connection = mockConnection;

            await service.publish("test.subject", { key: "value" });

            expect(mockPublish).toHaveBeenCalledWith(
                "test.subject",
                expect.any(Uint8Array),
            );

            // Verify the payload is valid JSON
            const payload = new TextDecoder().decode(
                mockPublish.mock.calls[0][1],
            );
            expect(JSON.parse(payload)).toEqual({ key: "value" });
        });

        it("should propagate errors from connection.publish", async () => {
            const mockConnection = {
                publish: jest.fn().mockImplementation(() => {
                    throw new Error("Publish failed");
                }),
                drain: jest.fn(),
                isClosed: jest.fn().mockReturnValue(false),
                status: jest
                    .fn()
                    .mockReturnValue({
                        [Symbol.asyncIterator]: () => ({
                            next: () => new Promise(() => {}),
                        }),
                    }),
            };

            (service as any).connection = mockConnection;

            await expect(
                service.publish("test.subject", { data: "test" }),
            ).rejects.toThrow("Publish failed");
        });
    });

    describe("subscribe", () => {
        it("should throw when not connected", async () => {
            await expect(
                service.subscribe("test.subject", jest.fn()),
            ).rejects.toThrow("NATS connection not established");
        });

        it("should subscribe to subject when connected", async () => {
            const mockSub = {
                [Symbol.asyncIterator]: () => ({
                    next: () => new Promise(() => {}),
                }),
            };
            const mockConnection = {
                subscribe: jest.fn().mockReturnValue(mockSub),
                drain: jest.fn(),
                isClosed: jest.fn().mockReturnValue(false),
            };

            (service as any).connection = mockConnection;

            await service.subscribe("test.subject", jest.fn());

            expect(mockConnection.subscribe).toHaveBeenCalledWith(
                "test.subject",
            );
        });
    });

    describe("disconnect", () => {
        it("should drain and null the connection when connected", async () => {
            const mockDrain = jest.fn().mockResolvedValue(undefined);
            (service as any).connection = {
                drain: mockDrain,
                isClosed: jest.fn().mockReturnValue(false),
            };

            await service.disconnect();

            expect(mockDrain).toHaveBeenCalled();
            expect((service as any).connection).toBeNull();
        });

        it("should do nothing when not connected", async () => {
            (service as any).connection = null;

            await service.disconnect();

            expect((service as any).connection).toBeNull();
        });
    });

    describe("isConnected", () => {
        it("should return false when connection is null", () => {
            (service as any).connection = null;

            expect(service.isConnected()).toBe(false);
        });

        it("should return false when connection is closed", () => {
            (service as any).connection = {
                isClosed: jest.fn().mockReturnValue(true),
            };

            expect(service.isConnected()).toBe(false);
        });

        it("should return true when connection is open", () => {
            (service as any).connection = {
                isClosed: jest.fn().mockReturnValue(false),
            };

            expect(service.isConnected()).toBe(true);
        });
    });

    describe("getConnection", () => {
        it("should return null when not connected", () => {
            expect(service.getConnection()).toBeNull();
        });

        it("should return the connection when connected", () => {
            const mockConn = { drain: jest.fn(), isClosed: jest.fn() };
            (service as any).connection = mockConn;

            expect(service.getConnection()).toBe(mockConn);
        });
    });
});
