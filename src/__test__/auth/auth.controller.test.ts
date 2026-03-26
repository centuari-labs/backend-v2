import { Test, TestingModule } from "@nestjs/testing";
import { AuthController } from "../../auth/auth.controller";
import { AuthService } from "../../auth/auth.service";

describe("AuthController", () => {
    let controller: AuthController;
    let authService: { validateAndCreateDepositWallet: jest.Mock };

    beforeEach(async () => {
        authService = {
            validateAndCreateDepositWallet: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [AuthController],
            providers: [{ provide: AuthService, useValue: authService }],
        }).compile();

        controller = module.get<AuthController>(AuthController);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("validate", () => {
        it("should delegate to AuthService with wallet_address", async () => {
            const mockResponse = {
                id: 1,
                wallet_address: "0x123",
                paired_wallet_address: "0xPaired",
                paired_wallet_primary_key: "0xKey",
            };
            authService.validateAndCreateDepositWallet.mockResolvedValue(
                mockResponse,
            );

            const result = await controller.validate({
                wallet_address: "0x123",
            });

            expect(result).toEqual(mockResponse);
            expect(
                authService.validateAndCreateDepositWallet,
            ).toHaveBeenCalledWith("0x123");
        });

        it("should propagate service errors", async () => {
            authService.validateAndCreateDepositWallet.mockRejectedValue(
                new Error("Service error"),
            );

            await expect(
                controller.validate({ wallet_address: "0xbad" }),
            ).rejects.toThrow("Service error");
        });
    });
});
