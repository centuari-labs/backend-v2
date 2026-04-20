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
    // Use current date so the test always aligns with what the validator
    // computes at runtime (it calls validateMaturitiesUtcSeconds with no `now`).
    const fixedNow = new Date();
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

        it("should include next month even if less than 7 days away", async () => {
            // Mock now to be 20th of April (11 days before May 1st) -> Should include May 1st
            const now11DaysBefore = new Date(Date.UTC(2026, 3, 20)); // April 20
            const allowed1 = getAllowedMaturitiesUtcSeconds(now11DaysBefore);
            const may1st = Math.floor(Date.UTC(2026, 4, 1) / 1000);
            expect(allowed1[0]).toBe(may1st);

            // Mock now to be 26th of April (5 days before May 1st) -> Should STILL include May 1st
            const now5DaysBefore = new Date(Date.UTC(2026, 3, 26)); // April 26
            const allowed2 = getAllowedMaturitiesUtcSeconds(now5DaysBefore);
            expect(allowed2[0]).toBe(may1st);
        });

        it("should correctly handle dates close to boundary", async () => {
            // Exactly 7 days before May 1st (May 1st 00:00 - April 24 00:00 = 7 days)
            const exactly7DaysBefore = new Date(
                Date.UTC(2026, 3, 24, 0, 0, 0, 0),
            );
            const allowed = getAllowedMaturitiesUtcSeconds(exactly7DaysBefore);
            const may1st = Math.floor(Date.UTC(2026, 4, 1) / 1000);
            expect(allowed[0]).toBe(may1st);

            // 6 days and 23 hours before May 1st -> Should STILL include May 1st
            const slightlyLess = new Date(Date.UTC(2026, 3, 24, 1, 0, 0, 0));
            const allowedSlightly =
                getAllowedMaturitiesUtcSeconds(slightlyLess);
            expect(allowedSlightly[0]).toBe(may1st);
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
