import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { AuthController } from "../../auth/auth.controller";
import { AuthService } from "../../auth/auth.service";

describe("AuthController", () => {
    let controller: AuthController;
    let authService: jest.Mocked<AuthService>;

    const mockDepositWallet = {
        id: 1,
        wallet_address: "0x1234567890abcdef1234567890abcdef12345678",
        paired_wallet_address: "0xPaired1234567890abcdef1234567890abcdef",
        paired_wallet_primary_key: "0xprivatekey123",
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [AuthController],
            providers: [
                {
                    provide: AuthService,
                    useValue: {
                        validateAndCreateDepositWallet: jest.fn(),
                    },
                },
            ],
        }).compile();

        controller = module.get<AuthController>(AuthController);
        authService = module.get(AuthService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("validate", () => {
        it("should call authService.validateAndCreateDepositWallet with wallet address", async () => {
            authService.validateAndCreateDepositWallet.mockResolvedValue(
                mockDepositWallet as any,
            );

            const result = await controller.validate({
                wallet_address: "0x1234567890abcdef1234567890abcdef12345678",
            });

            expect(result).toEqual(mockDepositWallet);
            expect(
                authService.validateAndCreateDepositWallet,
            ).toHaveBeenCalledWith(
                "0x1234567890abcdef1234567890abcdef12345678",
            );
        });

        it("should propagate BadRequestException from service", async () => {
            authService.validateAndCreateDepositWallet.mockRejectedValue(
                new BadRequestException("Invalid wallet address format"),
            );

            await expect(
                controller.validate({ wallet_address: "invalid" }),
            ).rejects.toThrow(BadRequestException);
        });

        it("should propagate database errors from service", async () => {
            authService.validateAndCreateDepositWallet.mockRejectedValue(
                new Error("DB error"),
            );

            await expect(
                controller.validate({ wallet_address: "0x123" }),
            ).rejects.toThrow("DB error");
        });
    });
});
