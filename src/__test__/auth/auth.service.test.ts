jest.mock("jose", () => ({}));
jest.mock("../../core/privy/privy.service");

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AuthService } from "../../auth/auth.service";
import {
    createMockDatabaseService,
    createMockViemServiceFull,
} from "../helpers/mock-services";
import { createMockAccessCode } from "../helpers/mock-factories";

describe("AuthService", () => {
    let service: AuthService;
    let databaseService: ReturnType<typeof createMockDatabaseService>;
    let viemService: ReturnType<typeof createMockViemServiceFull>;

    beforeEach(() => {
        databaseService = createMockDatabaseService();
        viemService = createMockViemServiceFull();
        service = new AuthService(databaseService as any, viemService as any);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("loginOrCreateAccount", () => {
        it("should upsert account and return result", async () => {
            const account = {
                id: "uuid-1",
                privy_user_id: "did:privy:user-1",
                user_wallet: "0xWallet",
            };
            databaseService.queryOne.mockResolvedValue(account);

            const result = await service.loginOrCreateAccount(
                "did:privy:user-1",
                "0xWallet",
            );

            expect(result).toEqual(account);
            expect(databaseService.queryOne).toHaveBeenCalledWith(
                expect.stringContaining("INSERT INTO accounts"),
                ["did:privy:user-1", "0xWallet"],
            );
        });

        it("should pass privyUserId and walletAddress as params", async () => {
            databaseService.queryOne.mockResolvedValue({});

            await service.loginOrCreateAccount("did:privy:xyz", "0xABC");

            expect(databaseService.queryOne).toHaveBeenCalledWith(
                expect.any(String),
                ["did:privy:xyz", "0xABC"],
            );
        });
    });

    describe("redeemAccessCode", () => {
        it("should redeem valid code — insert redemption, increment uses, flag account", async () => {
            const accessCode = createMockAccessCode();
            databaseService.queryOne
                .mockResolvedValueOnce(accessCode) // SELECT access_codes
                .mockResolvedValueOnce(null); // SELECT redemptions (not yet redeemed)
            databaseService.query.mockResolvedValue([]);

            const result = await service.redeemAccessCode(
                "did:privy:user-1",
                "CENTUARI-ABCDE",
            );

            expect(result).toEqual({ granted: true });
            // Should insert redemption
            expect(databaseService.query).toHaveBeenCalledWith(
                expect.stringContaining("INSERT INTO access_code_redemptions"),
                [accessCode.id, "did:privy:user-1"],
            );
            // Should increment uses
            expect(databaseService.query).toHaveBeenCalledWith(
                expect.stringContaining("current_uses = current_uses + 1"),
                [accessCode.id],
            );
            // Should flag account
            expect(databaseService.query).toHaveBeenCalledWith(
                expect.stringContaining("access_granted = true"),
                ["did:privy:user-1"],
            );
        });

        it("should throw BadRequestException for invalid/inactive code", async () => {
            databaseService.queryOne.mockResolvedValueOnce(null);

            await expect(
                service.redeemAccessCode("did:privy:user-1", "INVALID"),
            ).rejects.toThrow(BadRequestException);
        });

        it("should throw BadRequestException for expired code", async () => {
            const expiredCode = createMockAccessCode({
                expires_at: "2020-01-01T00:00:00.000Z",
            });
            databaseService.queryOne.mockResolvedValueOnce(expiredCode);

            await expect(
                service.redeemAccessCode("did:privy:user-1", "EXPIRED"),
            ).rejects.toThrow("Access code has expired");
        });

        it("should throw BadRequestException for exhausted code (current_uses >= max_uses)", async () => {
            const exhaustedCode = createMockAccessCode({
                max_uses: 10,
                current_uses: 10,
            });
            databaseService.queryOne.mockResolvedValueOnce(exhaustedCode);

            await expect(
                service.redeemAccessCode("did:privy:user-1", "EXHAUSTED"),
            ).rejects.toThrow("Access code has reached its usage limit");
        });

        it("should handle idempotent redemption — already redeemed, just set flag", async () => {
            const accessCode = createMockAccessCode();
            databaseService.queryOne
                .mockResolvedValueOnce(accessCode) // SELECT access_codes
                .mockResolvedValueOnce({ 1: 1 }); // existing redemption found
            databaseService.query.mockResolvedValue([]);

            const result = await service.redeemAccessCode(
                "did:privy:user-1",
                "CENTUARI-ABCDE",
            );

            expect(result).toEqual({ granted: true });
            // Should only update flag, NOT insert redemption
            expect(databaseService.query).toHaveBeenCalledTimes(1);
            expect(databaseService.query).toHaveBeenCalledWith(
                expect.stringContaining("access_granted = true"),
                ["did:privy:user-1"],
            );
        });

        it("should allow unlimited uses when max_uses is -1", async () => {
            const unlimitedCode = createMockAccessCode({
                max_uses: -1,
                current_uses: 999,
            });
            databaseService.queryOne
                .mockResolvedValueOnce(unlimitedCode)
                .mockResolvedValueOnce(null); // no existing redemption
            databaseService.query.mockResolvedValue([]);

            const result = await service.redeemAccessCode(
                "did:privy:user-1",
                "UNLIMITED",
            );

            expect(result).toEqual({ granted: true });
        });
    });

    describe("generateAccessCodes", () => {
        it("should generate requested count of codes", async () => {
            databaseService.queryOne.mockResolvedValue({
                id: "gen-1",
                code: "CENTUARI-XXXXX",
                max_uses: 5,
                expires_at: null,
            });

            const result = await service.generateAccessCodes({
                count: 3,
                max_uses: 5,
            });

            expect(result.codes).toHaveLength(3);
            expect(databaseService.queryOne).toHaveBeenCalledTimes(3);
        });

        it("should use default values when opts not provided", async () => {
            databaseService.queryOne.mockResolvedValue({
                id: "gen-1",
                code: "CENTUARI-ABCDE",
                max_uses: 1,
                expires_at: null,
            });

            const result = await service.generateAccessCodes({});

            // Default count is 1
            expect(result.codes).toHaveLength(1);
            // Default max_uses is 1
            expect(databaseService.queryOne).toHaveBeenCalledWith(
                expect.stringContaining("INSERT INTO access_codes"),
                [expect.stringContaining("CENTUARI-"), 1, null],
            );
        });
    });

    describe("deactivateAccessCode", () => {
        it("should deactivate and return updated code", async () => {
            const code = createMockAccessCode({ is_active: false });
            databaseService.queryOne.mockResolvedValue(code);

            const result = await service.deactivateAccessCode("ac-uuid-001");

            expect(result).toEqual(code);
            expect(databaseService.queryOne).toHaveBeenCalledWith(
                expect.stringContaining("is_active = false"),
                ["ac-uuid-001"],
            );
        });

        it("should throw NotFoundException when code not found", async () => {
            databaseService.queryOne.mockResolvedValue(null);

            await expect(
                service.deactivateAccessCode("nonexistent"),
            ).rejects.toThrow(NotFoundException);
        });
    });

    describe("validateAndCreateDepositWallet", () => {
        it("should create deposit wallet with paired wallet", async () => {
            const depositWallet = {
                id: "dw-1",
                wallet_address: "0xUserWallet",
                paired_wallet_address: "0xPairedWallet",
            };
            databaseService.insert.mockResolvedValue(depositWallet);

            const result =
                await service.validateAndCreateDepositWallet("0xUserWallet");

            expect(result).toEqual(depositWallet);
            expect(viemService.isValidAddress).toHaveBeenCalledWith(
                "0xUserWallet",
            );
            expect(viemService.generateWallet).toHaveBeenCalled();
            expect(databaseService.insert).toHaveBeenCalledWith(
                "deposit_wallets",
                expect.objectContaining({
                    wallet_address: "0xUserWallet",
                    paired_wallet_address: "0xPairedWallet",
                    paired_wallet_primary_key: "0xPairedKey",
                }),
            );
        });

        it("should throw BadRequestException for invalid wallet address", async () => {
            viemService.isValidAddress.mockReturnValue(false);

            await expect(
                service.validateAndCreateDepositWallet("invalid"),
            ).rejects.toThrow(BadRequestException);
        });
    });

    describe("updateName", () => {
        it("should update account name and return result", async () => {
            const account = { id: "uuid-1", name: "Alice" };
            databaseService.queryOne.mockResolvedValue(account);

            const result = await service.updateName(
                "did:privy:user-1",
                "Alice",
            );

            expect(result).toEqual(account);
            expect(databaseService.queryOne).toHaveBeenCalledWith(
                expect.stringContaining("UPDATE accounts SET name"),
                ["Alice", "did:privy:user-1"],
            );
        });
    });

    describe("listAccessCodes", () => {
        it("should return all access codes", async () => {
            const codes = [
                createMockAccessCode(),
                createMockAccessCode({ id: "ac-2", code: "CENTUARI-FGHIJ" }),
            ];
            databaseService.query.mockResolvedValue(codes);

            const result = await service.listAccessCodes();

            expect(result.codes).toHaveLength(2);
            expect(databaseService.query).toHaveBeenCalledWith(
                expect.stringContaining("SELECT"),
            );
        });
    });
});
