/**
 * Integration test: POST /faucet/request-tokens auth + recipient binding.
 *
 * Drives the full HTTP pipeline through the real AuthGuard with a mocked
 * PrivyAuthStrategy (token-aware) and a DI-mocked FaucetService so the test
 * never reaches the on-chain faucet contract. Covers:
 *   - 401 when Authorization header is missing
 *   - 401 when Authorization is "Bearer " (empty token, frontend `jwt ?? ""`)
 *   - 200 when Bearer wallet matches dto.recipientAddress
 *   - 403 when Bearer wallet does NOT match dto.recipientAddress
 *   - 200 when recipientAddress is uppercase of the auth'd wallet (case-insensitive)
 */

const AUTH_WALLET = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const OTHER_WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

jest.mock("../../core/privy/privy.service", () => ({}));
jest.mock("../../common/guards/strategies/privy-auth.strategy", () => ({
    PrivyAuthStrategy: class MockPrivyAuthStrategy {
        async validate(_token: string) {
            return { userId: "u-1", walletAddress: AUTH_WALLET };
        }
        async verifyPrincipal(_token: string) {
            return { userId: "u-1" };
        }
        async resolveAuthUser(_token: string) {
            return { userId: "u-1", walletAddress: AUTH_WALLET };
        }
        getName() {
            return "privy";
        }
    },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { HttpStatus, INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import type { App } from "supertest/types";

import { FaucetController } from "../../faucet/faucet.controller";
import { FaucetService } from "../../faucet/faucet.service";
import { AuthGuard } from "../../common/guards/auth.guard";
import { AuthStrategyFactory } from "../../common/guards/strategies/auth-strategy.factory";
import { RequestAuthService } from "../../common/guards/strategies/request-auth.service";
import { PrivyAuthStrategy } from "../../common/guards/strategies/privy-auth.strategy";
import type { FaucetResponseDto } from "../../faucet/dto/faucet.dto";

describe("Faucet POST /faucet/request-tokens — auth + recipient binding", () => {
    let app: INestApplication<App>;
    let mockFaucetService: { requestTokens: jest.Mock; getTokens: jest.Mock };

    const validBody = {
        chainId: 421614,
        recipientAddress: AUTH_WALLET,
        token: ["USDC"],
    };

    const mockResponse: FaucetResponseDto = {
        chainId: 421614,
        recipientAddress: AUTH_WALLET,
        transactionHash: "0xdeadbeef",
        blockNumber: "1",
        status: "success",
        results: [{ tokenAddress: "0xToken", amount: "1000000" }],
    };

    beforeAll(async () => {
        mockFaucetService = {
            requestTokens: jest.fn().mockResolvedValue(mockResponse),
            getTokens: jest.fn(),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [FaucetController],
            providers: [
                { provide: FaucetService, useValue: mockFaucetService },
                AuthGuard,
                RequestAuthService,
                AuthStrategyFactory,
                PrivyAuthStrategy,
            ],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(
            new ValidationPipe({
                whitelist: true,
                transform: true,
                forbidNonWhitelisted: true,
            }),
        );
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("returns 401 when Authorization header is missing", async () => {
        await request(app.getHttpServer())
            .post("/faucet/request-tokens")
            .send(validBody)
            .expect(HttpStatus.UNAUTHORIZED);

        expect(mockFaucetService.requestTokens).not.toHaveBeenCalled();
    });

    it("returns 401 when Authorization is 'Bearer ' with an empty token", async () => {
        await request(app.getHttpServer())
            .post("/faucet/request-tokens")
            .set("Authorization", "Bearer ")
            .send(validBody)
            .expect(HttpStatus.UNAUTHORIZED);

        expect(mockFaucetService.requestTokens).not.toHaveBeenCalled();
    });

    it("returns 200 and forwards to FaucetService when recipient matches the auth'd wallet", async () => {
        await request(app.getHttpServer())
            .post("/faucet/request-tokens")
            .set("Authorization", "Bearer valid-jwt")
            .send(validBody)
            .expect(HttpStatus.CREATED);

        expect(mockFaucetService.requestTokens).toHaveBeenCalledTimes(1);
        expect(mockFaucetService.requestTokens).toHaveBeenCalledWith(
            421614,
            AUTH_WALLET,
            ["USDC"],
        );
    });

    it("returns 403 when recipient differs from the auth'd wallet (anti-grief)", async () => {
        await request(app.getHttpServer())
            .post("/faucet/request-tokens")
            .set("Authorization", "Bearer valid-jwt")
            .send({ ...validBody, recipientAddress: OTHER_WALLET })
            .expect(HttpStatus.FORBIDDEN);

        expect(mockFaucetService.requestTokens).not.toHaveBeenCalled();
    });

    it("returns 200 when recipient is the uppercase form of the auth'd wallet (case-insensitive)", async () => {
        await request(app.getHttpServer())
            .post("/faucet/request-tokens")
            .set("Authorization", "Bearer valid-jwt")
            .send({
                ...validBody,
                recipientAddress: AUTH_WALLET.toUpperCase().replace("0X", "0x"),
            })
            .expect(HttpStatus.CREATED);

        expect(mockFaucetService.requestTokens).toHaveBeenCalledTimes(1);
    });
});
