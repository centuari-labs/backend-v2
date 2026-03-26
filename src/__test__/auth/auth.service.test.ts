import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { AuthService } from "../../auth/auth.service";
import { DatabaseService } from "../../core/database/database.service";
import { ViemService } from "../../core/viem/viem.service";
import {
    createMockDatabaseService,
    createMockViemService,
} from "../helpers/mock-services";

describe("AuthService", () => {
    let service: AuthService;
    let databaseService: ReturnType<typeof createMockDatabaseService>;
    let viemService: ReturnType<typeof createMockViemService>;

    beforeEach(async () => {
        databaseService = createMockDatabaseService();
        viemService = createMockViemService();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                { provide: DatabaseService, useValue: databaseService },
                { provide: ViemService, useValue: viemService },
            ],
        }).compile();

        service = module.get<AuthService>(AuthService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("validateAndCreateDepositWallet", () => {
        const validWallet = "0x1234567890abcdef1234567890abcdef12345678";
        const mockPairedWallet = {
            address: "0xPaired1234567890abcdef1234567890abcdef12",
            privateKey: "0xprivatekey123",
        };
        const mockInsertResult = {
            id: 1,
            wallet_address: validWallet,
            paired_wallet_address: mockPairedWallet.address,
            paired_wallet_primary_key: mockPairedWallet.privateKey,
        };

        it("should create deposit wallet for valid address", async () => {
            viemService.isValidAddress.mockReturnValue(true);
            viemService.generateWallet.mockReturnValue(mockPairedWallet);
            databaseService.insert.mockResolvedValue(mockInsertResult);

            const result =
                await service.validateAndCreateDepositWallet(validWallet);

            expect(result).toEqual(mockInsertResult);
            expect(viemService.isValidAddress).toHaveBeenCalledWith(
                validWallet,
            );
            expect(viemService.generateWallet).toHaveBeenCalled();
            expect(databaseService.insert).toHaveBeenCalledWith(
                "deposit_wallets",
                {
                    wallet_address: validWallet,
                    paired_wallet_address: mockPairedWallet.address,
                    paired_wallet_primary_key: mockPairedWallet.privateKey,
                },
            );
        });

        it("should throw BadRequestException for invalid wallet address", async () => {
            viemService.isValidAddress.mockReturnValue(false);

            await expect(
                service.validateAndCreateDepositWallet("invalid-address"),
            ).rejects.toThrow(BadRequestException);

            expect(viemService.isValidAddress).toHaveBeenCalledWith(
                "invalid-address",
            );
            expect(viemService.generateWallet).not.toHaveBeenCalled();
            expect(databaseService.insert).not.toHaveBeenCalled();
        });

        it("should throw BadRequestException with correct message for invalid address", async () => {
            viemService.isValidAddress.mockReturnValue(false);

            await expect(
                service.validateAndCreateDepositWallet("0xbad"),
            ).rejects.toThrow("Invalid wallet address format");
        });

        it("should propagate database insert errors", async () => {
            viemService.isValidAddress.mockReturnValue(true);
            viemService.generateWallet.mockReturnValue(mockPairedWallet);
            databaseService.insert.mockRejectedValue(
                new Error("DB connection failed"),
            );

            await expect(
                service.validateAndCreateDepositWallet(validWallet),
            ).rejects.toThrow("DB connection failed");
        });

        it("should pass empty string to isValidAddress when empty wallet provided", async () => {
            viemService.isValidAddress.mockReturnValue(false);

            await expect(
                service.validateAndCreateDepositWallet(""),
            ).rejects.toThrow(BadRequestException);

            expect(viemService.isValidAddress).toHaveBeenCalledWith("");
        });
    });
});
