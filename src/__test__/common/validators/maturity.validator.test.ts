import { validate } from "class-validator";
import { IsValidMaturities } from "../../../common/validators/maturity.validator";
import { getAllowedMaturitiesUtcSeconds } from "../../../orders/utils/maturity.utils";

class TestMaturitiesDto {
    @IsValidMaturities({
        message:
            "Maturities must be on the 1st day of the next three calendar months (UTC).",
    })
    maturities: number[];
}

describe("Maturity Validators", () => {
    const fixedNow = new Date(Date.UTC(2026, 1, 15, 0, 0, 0)); // 2026-02-15 UTC
    const allowedMaturities = getAllowedMaturitiesUtcSeconds(fixedNow);

    const createDto = (maturities: number[]): TestMaturitiesDto => {
        const dto = new TestMaturitiesDto();
        dto.maturities = maturities;
        return dto;
    };

    describe("IsValidMaturities", () => {
        it("should accept maturities that are allowed first-of-month dates", async () => {
            const dto = createDto([allowedMaturities[0]]);
            const errors = await validate(dto);
            expect(errors).toHaveLength(0);
        });

        it("should accept multiple maturities all within allowed set", async () => {
            const dto = createDto(allowedMaturities);
            const errors = await validate(dto);
            expect(errors).toHaveLength(0);
        });

        it("should reject maturities not on the 1st of a month", async () => {
            const invalid = allowedMaturities[0] + 24 * 60 * 60;
            const dto = createDto([invalid]);
            const errors = await validate(dto);
            expect(errors.length).toBeGreaterThan(0);
        });

        it("should reject maturities beyond the next three calendar months", async () => {
            const beyond = allowedMaturities[2] + 31 * 24 * 60 * 60;
            const dto = createDto([beyond]);
            const errors = await validate(dto);
            expect(errors.length).toBeGreaterThan(0);
        });

        it("should reject non-array values", async () => {
            const dto = new TestMaturitiesDto();
            // @ts-expect-error testing runtime behaviour with non-array
            dto.maturities = null;
            const errors = await validate(dto);
            expect(errors.length).toBeGreaterThan(0);
        });

        it("should reject arrays with non-number entries", async () => {
            const dto = createDto([
                allowedMaturities[0],
                "not-a-number" as any,
            ]);
            const errors = await validate(dto);
            expect(errors.length).toBeGreaterThan(0);
        });
    });
});
