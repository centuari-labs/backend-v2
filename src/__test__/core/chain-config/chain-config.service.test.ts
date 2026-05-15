import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { ChainConfigService } from "../../../core/chain-config/chain-config.service";

describe("ChainConfigService", () => {
    it("should read env vars and parse correctly", async () => {
        const mockConfigService = {
            get: jest.fn((key: string) => {
                const config: Record<string, string> = {
                    DEPOSIT_CHAIN_ID: "11155111",
                    OPERATOR_PRIVATE_KEY: "0xprivkey",
                    HUB_DEPOSITOR_ADDRESS: "0xhubdepositor",
                    CENTUARI_ADDRESS: "0xcentuari",
                };
                return config[key];
            }),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ChainConfigService,
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        const service = module.get<ChainConfigService>(ChainConfigService);

        expect(service.chainId).toBe(11155111);
        expect(service.operatorPrivateKey).toBe("0xprivkey");
        expect(service.hubDepositorAddress).toBe("0xhubdepositor");
        expect(service.centuariAddress).toBe("0xcentuari");
    });

    it("should apply defaults when env vars are not set", async () => {
        const mockConfigService = {
            get: jest.fn(() => undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ChainConfigService,
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        const service = module.get<ChainConfigService>(ChainConfigService);

        expect(service.chainId).toBe(421614);
        expect(service.operatorPrivateKey).toBe("");
        expect(service.hubDepositorAddress).toBe("");
        expect(service.centuariAddress).toBe("");
    });
});
