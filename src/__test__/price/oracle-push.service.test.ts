import { Logger } from "@nestjs/common";
import { parseUnits } from "viem";
import { OraclePushService } from "../../price/oracle-push.service";
import { PriceService } from "../../price/price.service";
import { TokensRepository } from "../../tokens/repositories/tokens.repository";
import { ChainConfigService } from "../../core/chain-config/chain-config.service";
import { ViemService } from "../../core/viem/viem.service";
import { Token } from "../../tokens/entities/token.entity";

const mkToken = (id: string, symbol: string): Token =>
    ({ id, symbol }) as unknown as Token;

describe("OraclePushService", () => {
    let loggerSpies: jest.SpyInstance[];

    const build = (overrides: {
        operatorPrivateKey?: string;
        pushOracles?: Record<string, string>;
        cacheReady?: boolean;
        prices?: Record<string, number>;
        tokens?: Token[];
        writeImpl?: jest.Mock;
    }) => {
        const writeContract =
            overrides.writeImpl ?? jest.fn().mockResolvedValue("0xhash");

        const chainConfig = {
            chainId: 421614,
            operatorPrivateKey: overrides.operatorPrivateKey ?? "0xoperatorkey",
            pushOracles:
                overrides.pushOracles ?? { USDC: "0xUSDCoracle", BTC: "0xBTCoracle" },
        } as unknown as ChainConfigService;

        const priceService = {
            isCacheReady: jest.fn().mockReturnValue(overrides.cacheReady ?? true),
            getPrices: jest
                .fn()
                .mockReturnValue(
                    overrides.prices ?? { "usdc-id": 1, "btc-id": 95000 },
                ),
        } as unknown as PriceService;

        const tokensRepository = {
            getActiveTokens: jest
                .fn()
                .mockResolvedValue(
                    overrides.tokens ?? [
                        mkToken("usdc-id", "USDC"),
                        mkToken("btc-id", "BTC"),
                        mkToken("eth-id", "ETH"), // no PushOracle configured
                    ],
                ),
        } as unknown as TokensRepository;

        const viemService = { writeContract } as unknown as ViemService;

        const service = new OraclePushService(
            chainConfig,
            priceService,
            tokensRepository,
            viemService,
        );
        return { service, writeContract };
    };

    beforeAll(() => {
        loggerSpies = [
            jest.spyOn(Logger.prototype, "log").mockImplementation(() => {}),
            jest.spyOn(Logger.prototype, "debug").mockImplementation(() => {}),
            jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {}),
            jest.spyOn(Logger.prototype, "error").mockImplementation(() => {}),
        ];
    });

    afterAll(() => loggerSpies.forEach((s) => s.mockRestore()));
    afterEach(() => jest.clearAllMocks());

    it("pushes 1e18-scaled prices only for tokens with a PushOracle", async () => {
        const { service, writeContract } = build({});
        await service.pushAllPrices();

        expect(writeContract).toHaveBeenCalledTimes(2); // USDC + BTC, not ETH
        expect(writeContract).toHaveBeenCalledWith(
            421614,
            "0xoperatorkey",
            "0xUSDCoracle",
            expect.anything(),
            "setPrice",
            [parseUnits("1", 18)],
        );
        expect(writeContract).toHaveBeenCalledWith(
            421614,
            "0xoperatorkey",
            "0xBTCoracle",
            expect.anything(),
            "setPrice",
            [parseUnits("95000", 18)],
        );
    });

    it("does nothing without an operator key", async () => {
        const { service, writeContract } = build({ operatorPrivateKey: "" });
        await service.pushAllPrices();
        expect(writeContract).not.toHaveBeenCalled();
    });

    it("does nothing when no PushOracles are configured", async () => {
        const { service, writeContract } = build({ pushOracles: {} });
        await service.pushAllPrices();
        expect(writeContract).not.toHaveBeenCalled();
    });

    it("skips when the price cache is not ready", async () => {
        const { service, writeContract } = build({ cacheReady: false });
        await service.pushAllPrices();
        expect(writeContract).not.toHaveBeenCalled();
    });

    it("skips tokens with no/invalid price", async () => {
        const { service, writeContract } = build({ prices: { "usdc-id": 1 } }); // BTC missing
        await service.pushAllPrices();
        expect(writeContract).toHaveBeenCalledTimes(1);
        expect(writeContract).toHaveBeenCalledWith(
            421614,
            "0xoperatorkey",
            "0xUSDCoracle",
            expect.anything(),
            "setPrice",
            [parseUnits("1", 18)],
        );
    });

    it("isolates per-token failures (one revert does not block the rest)", async () => {
        const writeImpl = jest
            .fn()
            .mockRejectedValueOnce(new Error("deviation too large"))
            .mockResolvedValue("0xhash");
        const { service } = build({ writeImpl });

        await expect(service.pushAllPrices()).resolves.toBeUndefined();
        expect(writeImpl).toHaveBeenCalledTimes(2); // both attempted despite first failing
    });
});
