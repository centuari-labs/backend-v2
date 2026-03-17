import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateBorrowLimitOrderDto } from "../../../orders/dto/create-borrow-limit-order.dto";

describe("CreateBorrowLimitOrderDto", () => {
    const validDto = {
        assetId: "b66a2641-3339-4a48-805c-6da248f33dee",
        amount: "1000",
        marketIds: ["550e8400-e29b-41d4-a716-446655440000"],
        rate: 500, // 5% in basis points
    };

    const createDto = (
        overrides: Partial<typeof validDto> = {},
    ): CreateBorrowLimitOrderDto => {
        return plainToInstance(CreateBorrowLimitOrderDto, {
            ...validDto,
            ...overrides,
        });
    };

    describe("rate validation", () => {
        it("should accept exactly 1 basis point (0.01%)", async () => {
            const dto = createDto({ rate: 1 });
            const errors = await validate(dto);
            const rateErrors = errors.filter((e) => e.property === "rate");
            expect(rateErrors).toHaveLength(0);
        });

        it("should accept exactly 10000 basis points (100%)", async () => {
            const dto = createDto({ rate: 10000 });
            const errors = await validate(dto);
            const rateErrors = errors.filter((e) => e.property === "rate");
            expect(rateErrors).toHaveLength(0);
        });

        it("should accept rate within valid range (750 bp = 7.5%)", async () => {
            const dto = createDto({ rate: 750 });
            const errors = await validate(dto);
            const rateErrors = errors.filter((e) => e.property === "rate");
            expect(rateErrors).toHaveLength(0);
        });

        it("should reject 0 basis points", async () => {
            const dto = createDto({ rate: 0 });
            const errors = await validate(dto);
            const rateErrors = errors.filter((e) => e.property === "rate");
            expect(rateErrors.length).toBeGreaterThan(0);
            expect(rateErrors[0].constraints).toHaveProperty("min");
        });

        it("should reject negative rate", async () => {
            const dto = createDto({ rate: -50 });
            const errors = await validate(dto);
            const rateErrors = errors.filter((e) => e.property === "rate");
            expect(rateErrors.length).toBeGreaterThan(0);
        });

        it("should reject rate exceeding 10000 basis points", async () => {
            const dto = createDto({ rate: 10001 });
            const errors = await validate(dto);
            const rateErrors = errors.filter((e) => e.property === "rate");
            expect(rateErrors.length).toBeGreaterThan(0);
            expect(rateErrors[0].constraints).toHaveProperty("max");
        });

        it("should reject extremely high rate (20000 bp)", async () => {
            const dto = createDto({ rate: 20000 });
            const errors = await validate(dto);
            const rateErrors = errors.filter((e) => e.property === "rate");
            expect(rateErrors.length).toBeGreaterThan(0);
        });

        it("should reject non-integer rate", async () => {
            const dto = createDto({ rate: 7.25 as any });
            const errors = await validate(dto);
            const rateErrors = errors.filter((e) => e.property === "rate");
            expect(rateErrors.length).toBeGreaterThan(0);
        });
    });

    describe("amount validation", () => {
        it("should accept valid positive numeric string", async () => {
            const dto = createDto({ amount: "5000" });
            const errors = await validate(dto);
            const amountErrors = errors.filter((e) => e.property === "amount");
            expect(amountErrors).toHaveLength(0);
        });

        it("should accept amount exactly at minimum (1 USD)", async () => {
            const dto = createDto({ amount: "1" });
            const errors = await validate(dto);
            const amountErrors = errors.filter((e) => e.property === "amount");
            expect(amountErrors).toHaveLength(0);
        });

        it("should accept decimal amount", async () => {
            const dto = createDto({ amount: "1000.50" });
            const errors = await validate(dto);
            const amountErrors = errors.filter((e) => e.property === "amount");
            expect(amountErrors).toHaveLength(0);
        });

        it("should reject zero amount", async () => {
            const dto = createDto({ amount: "0" });
            const errors = await validate(dto);
            const amountErrors = errors.filter((e) => e.property === "amount");
            expect(amountErrors.length).toBeGreaterThan(0);
        });

        it("should reject negative amount", async () => {
            const dto = createDto({ amount: "-500" });
            const errors = await validate(dto);
            const amountErrors = errors.filter((e) => e.property === "amount");
            expect(amountErrors.length).toBeGreaterThan(0);
        });

        it("should reject non-numeric string", async () => {
            const dto = createDto({ amount: "invalid" });
            const errors = await validate(dto);
            const amountErrors = errors.filter((e) => e.property === "amount");
            expect(amountErrors.length).toBeGreaterThan(0);
        });

        it("should reject amount less than minimum", async () => {
            const dto = createDto({ amount: "0.5" });
            const errors = await validate(dto);
            const amountErrors = errors.filter((e) => e.property === "amount");
            expect(amountErrors.length).toBeGreaterThan(0);
        });
    });

    describe("assetId validation", () => {
        it("should accept valid asset id", async () => {
            const dto = createDto();
            const errors = await validate(dto);
            const tokenErrors = errors.filter((e) => e.property === "assetId");
            expect(tokenErrors).toHaveLength(0);
        });

        it("should reject empty assetId", async () => {
            const dto = createDto({ assetId: "" });
            const errors = await validate(dto);
            const tokenErrors = errors.filter((e) => e.property === "assetId");
            expect(tokenErrors.length).toBeGreaterThan(0);
        });
    });

    describe("marketIds validation (UUID array)", () => {
        it("should accept a single valid marketId", async () => {
            const dto = createDto({
                marketIds: ["550e8400-e29b-41d4-a716-446655440000"],
            });
            const errors = await validate(dto);
            const marketIdErrors = errors.filter(
                (e) => e.property === "marketIds",
            );
            expect(marketIdErrors).toHaveLength(0);
        });

        it("should accept multiple valid marketIds", async () => {
            const dto = createDto({
                marketIds: [
                    "550e8400-e29b-41d4-a716-446655440000",
                    "123e4567-e89b-12d3-a456-426614174000",
                ],
            });
            const errors = await validate(dto);
            const marketIdErrors = errors.filter(
                (e) => e.property === "marketIds",
            );
            expect(marketIdErrors).toHaveLength(0);
        });

        it("should reject empty marketIds array", async () => {
            const dto = createDto({ marketIds: [] });
            const errors = await validate(dto);
            const marketIdErrors = errors.filter(
                (e) => e.property === "marketIds",
            );
            expect(marketIdErrors.length).toBeGreaterThan(0);
        });

        it("should reject non-UUID marketIds", async () => {
            const dto = createDto({ marketIds: ["not-a-uuid"] as any });
            const errors = await validate(dto);
            const marketIdErrors = errors.filter(
                (e) => e.property === "marketIds",
            );
            expect(marketIdErrors.length).toBeGreaterThan(0);
        });
    });

    describe("complete dto validation", () => {
        it("should pass validation with all valid fields", async () => {
            const dto = createDto();
            const errors = await validate(dto);
            expect(errors).toHaveLength(0);
        });

        it("should fail with multiple invalid fields", async () => {
            const dto = createDto({ rate: 0, amount: "-100", marketIds: [] });
            const errors = await validate(dto);
            expect(errors.length).toBeGreaterThan(1);
        });
    });
});
