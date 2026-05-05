const mockConnection = {
    publish: jest.fn(),
    subscribe: jest.fn(),
    drain: jest.fn().mockResolvedValue(undefined),
    isClosed: jest.fn().mockReturnValue(false),
    status: jest.fn().mockReturnValue({
        [Symbol.asyncIterator]: () => ({
            next: jest.fn().mockResolvedValue({ done: true }),
        }),
    }),
};

const mockConnect = jest.fn().mockResolvedValue(mockConnection);

jest.mock("nats", () => ({
    connect: mockConnect,
}));

import { NatsService } from "../../../core/nats/nats.service";

describe("NatsService", () => {
    let service: NatsService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new NatsService();
    });

    describe("connect / disconnect", () => {
        it("should call nats.connect with correct options on onModuleInit", async () => {
            await service.onModuleInit();

            expect(mockConnect).toHaveBeenCalledWith(
                expect.objectContaining({
                    servers: expect.any(String),
                    maxReconnectAttempts: -1,
                    reconnectTimeWait: 1000,
                    name: "centuari-backend",
                }),
            );
            expect(service.isConnected()).toBe(true);
        });

        it("should set connection to null after disconnect / drain", async () => {
            await service.onModuleInit();
            expect(service.isConnected()).toBe(true);

            await service.disconnect();

            expect(mockConnection.drain).toHaveBeenCalled();
            expect(service.getConnection()).toBeNull();
        });

        it("should retry connection on initial failure", async () => {
            jest.useFakeTimers();
            mockConnect
                .mockRejectedValueOnce(new Error("Connection refused"))
                .mockResolvedValueOnce(mockConnection);

            const initPromise = service.onModuleInit();

            // First attempt fails, triggers setTimeout retry
            await jest.advanceTimersByTimeAsync(1100);

            expect(mockConnect).toHaveBeenCalledTimes(2);
            expect(service.isConnected()).toBe(true);

            jest.useRealTimers();
        });
    });

    describe("publish", () => {
        it("should encode data as JSON and publish to subject", async () => {
            await service.onModuleInit();

            const data = { orderId: "123", amount: 100 };
            await service.publish("orders.create", data);

            expect(mockConnection.publish).toHaveBeenCalledWith(
                "orders.create",
                expect.any(Uint8Array),
            );

            // Verify the payload is correct JSON
            const publishedPayload = mockConnection.publish.mock.calls[0][1];
            const decoded = new TextDecoder().decode(publishedPayload);
            expect(JSON.parse(decoded)).toEqual(data);
        });

        it("should throw when connection is null", async () => {
            // Don't call onModuleInit — connection remains null
            await expect(
                service.publish("test.subject", { data: "test" }),
            ).rejects.toThrow("NATS connection not established");
        });

        it("should propagate errors from connection.publish", async () => {
            await service.onModuleInit();
            mockConnection.publish.mockImplementationOnce(() => {
                throw new Error("Publish failed");
            });

            await expect(
                service.publish("test.subject", { data: "test" }),
            ).rejects.toThrow("Publish failed");
        });
    });

    describe("subscribe", () => {
        it("should throw when connection is null", async () => {
            await expect(
                service.subscribe("test.subject", jest.fn()),
            ).rejects.toThrow("NATS connection not established");
        });

        it("should invoke callback with parsed JSON messages", async () => {
            const testData = { orderId: "456", status: "filled" };
            const encoded = new TextEncoder().encode(JSON.stringify(testData));

            // Create a subscription that yields one message then completes
            let resolveIterator: () => void;
            const iteratorDone = new Promise<void>((res) => {
                resolveIterator = res;
            });

            const messages = [{ data: encoded, subject: "orders.status" }];
            let index = 0;

            mockConnection.subscribe.mockReturnValueOnce({
                [Symbol.asyncIterator]: () => ({
                    next: () => {
                        if (index < messages.length) {
                            return Promise.resolve({
                                value: messages[index++],
                                done: false,
                            });
                        }
                        resolveIterator();
                        return new Promise(() => {}); // hang to stop iteration
                    },
                }),
            });

            const callback = jest.fn();
            await service.onModuleInit();
            await service.subscribe("orders.status", callback);

            // Wait for the message to be processed
            await iteratorDone;

            expect(callback).toHaveBeenCalledWith(testData, "orders.status");
        });

        it("should catch and log JSON parse errors without crashing", async () => {
            const invalidJson = new TextEncoder().encode("not valid json{{{");

            let resolveIterator: () => void;
            const iteratorDone = new Promise<void>((res) => {
                resolveIterator = res;
            });

            const messages = [{ data: invalidJson, subject: "orders.status" }];
            let index = 0;

            mockConnection.subscribe.mockReturnValueOnce({
                [Symbol.asyncIterator]: () => ({
                    next: () => {
                        if (index < messages.length) {
                            return Promise.resolve({
                                value: messages[index++],
                                done: false,
                            });
                        }
                        resolveIterator();
                        return new Promise(() => {});
                    },
                }),
            });

            const callback = jest.fn();
            await service.onModuleInit();

            // Should not throw
            await service.subscribe("orders.status", callback);
            await iteratorDone;

            // Callback should not be called since JSON parse failed
            expect(callback).not.toHaveBeenCalled();
        });

        it("should catch and log callback errors without crashing", async () => {
            const testData = { orderId: "789" };
            const encoded = new TextEncoder().encode(JSON.stringify(testData));

            let resolveIterator: () => void;
            const iteratorDone = new Promise<void>((res) => {
                resolveIterator = res;
            });

            const messages = [{ data: encoded, subject: "orders.status" }];
            let index = 0;

            mockConnection.subscribe.mockReturnValueOnce({
                [Symbol.asyncIterator]: () => ({
                    next: () => {
                        if (index < messages.length) {
                            return Promise.resolve({
                                value: messages[index++],
                                done: false,
                            });
                        }
                        resolveIterator();
                        return new Promise(() => {});
                    },
                }),
            });

            const callback = jest
                .fn()
                .mockRejectedValue(new Error("Callback error"));
            await service.onModuleInit();

            // Should not throw even though callback rejects
            await service.subscribe("orders.status", callback);
            await iteratorDone;

            expect(callback).toHaveBeenCalledWith(testData, "orders.status");
        });
    });

    describe("isConnected", () => {
        it("should return true when connection exists and not closed", async () => {
            await service.onModuleInit();
            mockConnection.isClosed.mockReturnValue(false);

            expect(service.isConnected()).toBe(true);
        });

        it("should return false when connection is null", () => {
            expect(service.isConnected()).toBe(false);
        });
    });
});
