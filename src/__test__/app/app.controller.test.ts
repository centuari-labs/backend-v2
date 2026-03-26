jest.mock("../../core/privy/privy.service", () => ({}));

import { AppController } from "../../app.controller";

describe("AppController", () => {
    let controller: AppController;

    beforeEach(() => {
        controller = new AppController();
    });

    describe("getHello", () => {
        it('should return "Hello World!"', () => {
            expect(controller.getHello()).toBe("Hello World!");
        });

        it("should return a string", () => {
            expect(typeof controller.getHello()).toBe("string");
        });
    });

    describe("getMe", () => {
        it("should return authenticated user message", async () => {
            const mockReq = {
                user: { id: "user-1", walletAddress: "0x123" },
            } as any;

            const result = await controller.getMe(mockReq);

            expect(result).toEqual({
                message: "Authenticated via Privy!",
                user: { id: "user-1", walletAddress: "0x123" },
            });
        });

        it("should include user from request", async () => {
            const mockReq = {
                user: { role: "admin" },
            } as any;

            const result = await controller.getMe(mockReq);

            expect(result.user).toEqual({ role: "admin" });
        });
    });
});
