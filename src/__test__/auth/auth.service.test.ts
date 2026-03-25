import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { AuthService } from "../../auth/auth.service";
import { DatabaseService } from "../../core/database/database.service";
import { ViemService } from "../../core/viem/viem.service";

describe("AuthService", () => {
    let service: AuthService;
    let databaseService: jest.Mocked<DatabaseService>;
    let viemService: jest.Mocked<ViemService>;

    const mockWalletAddress = "0x1234567890abcdef1234567890abcdef12345678";
    const mockPairedWallet = {
        address: "0xPairedAddress1234567890abcdef1234567890",
        privateKey: "0xprivatekey123",
    };
    const mockDepositWallet = {
        id: 1,
        wallet_address: mockWalletAddress,
        paired_wallet_address: mockPairedWallet.address,
        paired_wallet_primary_key: mockPairedWallet.privateKey,
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                {
                    provide: DatabaseService,
                    useValue: {
                        insert: jest.fn(),
                    },
                },
                {
                    provide: ViemService,
                    useValue: {
                        isValidAddress: jest.fn(),
                        generateWallet: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get<AuthService>(AuthService);
        databaseService = module.get(DatabaseService);
        viemService = module.get(ViemService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("validateAndCreateDepositWallet", () => {
        it("should create deposit wallet for valid address", async () => {
            viemService.isValidAddress.mockReturnValue(true);
            viemService.generateWallet.mockReturnValue(mockPairedWallet);
            databaseService.insert.mockResolvedValue(mockDepositWallet as any);

            const result =
                await service.validateAndCreateDepositWallet(mockWalletAddress);

            expect(result).toEqual(mockDepositWallet);
            expect(viemService.isValidAddress).toHaveBeenCalledWith(
                mockWalletAddress,
            );
            expect(viemService.generateWallet).toHaveBeenCalled();
            expect(databaseService.insert).toHaveBeenCalledWith(
                "deposit_wallets",
                {
                    wallet_address: mockWalletAddress,
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
                service.validateAndCreateDepositWallet("bad"),
            ).rejects.toThrow("Invalid wallet address format");
        });

        it("should propagate database insert errors", async () => {
            viemService.isValidAddress.mockReturnValue(true);
            viemService.generateWallet.mockReturnValue(mockPairedWallet);
            databaseService.insert.mockRejectedValue(
                new Error("DB connection lost"),
            );

            await expect(
                service.validateAndCreateDepositWallet(mockWalletAddress),
            ).rejects.toThrow("DB connection lost");
        });

        it("should pass empty string address to validation", async () => {
            viemService.isValidAddress.mockReturnValue(false);

            await expect(
                service.validateAndCreateDepositWallet(""),
            ).rejects.toThrow(BadRequestException);
        });
    });
});
