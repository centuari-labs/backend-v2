import { validate, ValidationError } from "class-validator";
import {
    IsMinAmount,
    IsPositiveNumericString,
} from "../../../common/validators/amount.validator";

class TestPositiveNumericStringDto {
    @IsPositiveNumericString({ message: "Value must be a positive number" })
    value: string;
}

class TestMinAmountDto {
    @IsMinAmount(100, { message: "Amount must be at least 100" })
    amount: string;
}

class TestCombinedDto {
    @IsPositiveNumericString({ message: "Must be a positive numeric string" })
    @IsMinAmount(1, { message: "Must be at least 1" })
    value: string;
}

describe("Amount Validators", () => {
    describe("IsPositiveNumericString", () => {
        const createDto = (value: string): TestPositiveNumericStringDto => {
            const dto = new TestPositiveNumericStringDto();
            dto.value = value;
            return dto;
        };

        describe("valid cases", () => {
            it("should accept positive integer string", async () => {
                const dto = createDto("100");
                const errors = await validate(dto);
                expect(errors).toHaveLength(0);
            });

            it("should accept positive decimal string", async () => {
                const dto = createDto("100.50");
                const errors = await validate(dto);
                expect(errors).toHaveLength(0);
            });

            it("should accept large positive number", async () => {
                const dto = createDto("999999999999999999");
                const errors = await validate(dto);
                expect(errors).toHaveLength(0);
            });

            it("should accept small positive decimal", async () => {
                const dto = createDto("0.001");
                const errors = await validate(dto);
                expect(errors).toHaveLength(0);
            });
        });

        describe("invalid cases", () => {
            it("should reject zero", async () => {
                const dto = createDto("0");
                const errors = await validate(dto);
                expect(errors.length).toBeGreaterThan(0);
                expect(errors[0].constraints).toBeDefined();
            });

            it("should reject negative number", async () => {
                const dto = createDto("-100");
                const errors = await validate(dto);
                expect(errors.length).toBeGreaterThan(0);
            });

            it("should reject non-numeric string", async () => {
                const dto = createDto("abc");
                const errors = await validate(dto);
                expect(errors.length).toBeGreaterThan(0);
            });

            it("should reject string starting with non-numeric characters", async () => {
                const dto = createDto("abc100");
                const errors = await validate(dto);
                expect(errors.length).toBeGreaterThan(0);
            });

            it("should reject empty string", async () => {
                const dto = createDto("");
                const errors = await validate(dto);
                expect(errors.length).toBeGreaterThan(0);
            });

            it("should reject whitespace string", async () => {
                const dto = createDto("   ");
                const errors = await validate(dto);
                expect(errors.length).toBeGreaterThan(0);
            });

            it("should reject negative zero", async () => {
                const dto = createDto("-0");
                const errors = await validate(dto);
                // -0 is considered 0, which is not positive
                expect(errors.length).toBeGreaterThan(0);
            });
        });
    });

    describe("IsMinAmount", () => {
        const createDto = (amount: string): TestMinAmountDto => {
            const dto = new TestMinAmountDto();
            dto.amount = amount;
            return dto;
        };

        describe("valid cases", () => {
            it("should accept value exactly at minimum", async () => {
                const dto = createDto("100");
                const errors = await validate(dto);
                expect(errors).toHaveLength(0);
            });

            it("should accept value above minimum", async () => {
                const dto = createDto("500");
                const errors = await validate(dto);
                expect(errors).toHaveLength(0);
            });

            it("should accept large value", async () => {
                const dto = createDto("1000000");
                const errors = await validate(dto);
                expect(errors).toHaveLength(0);
            });
        });

        describe("invalid cases", () => {
            it("should reject value below minimum", async () => {
                const dto = createDto("99");
                const errors = await validate(dto);
                expect(errors.length).toBeGreaterThan(0);
            });

            it("should reject zero", async () => {
                const dto = createDto("0");
                const errors = await validate(dto);
                expect(errors.length).toBeGreaterThan(0);
            });

            it("should reject negative value", async () => {
                const dto = createDto("-100");
                const errors = await validate(dto);
                expect(errors.length).toBeGreaterThan(0);
            });

            it("should reject non-numeric string", async () => {
                const dto = createDto("not-a-number");
                const errors = await validate(dto);
                expect(errors.length).toBeGreaterThan(0);
            });
        });

        describe("boundary cases", () => {
            it("should accept value just at minimum (100.0)", async () => {
                const dto = createDto("100.0");
                const errors = await validate(dto);
                expect(errors).toHaveLength(0);
            });

            it("should reject value just below minimum (99.99)", async () => {
                const dto = createDto("99.99");
                const errors = await validate(dto);
                expect(errors.length).toBeGreaterThan(0);
            });
        });
    });

    describe("Combined Validators", () => {
        const createDto = (value: string): TestCombinedDto => {
            const dto = new TestCombinedDto();
            dto.value = value;
            return dto;
        };

        it("should pass with valid positive value above minimum", async () => {
            const dto = createDto("100");
            const errors = await validate(dto);
            expect(errors).toHaveLength(0);
        });

        it("should pass with value exactly at minimum", async () => {
            const dto = createDto("1");
            const errors = await validate(dto);
            expect(errors).toHaveLength(0);
        });

        it("should fail with zero (fails IsPositiveNumericString)", async () => {
            const dto = createDto("0");
            const errors = await validate(dto);
            expect(errors.length).toBeGreaterThan(0);
        });

        it("should fail with value below minimum (fails IsMinAmount)", async () => {
            const dto = createDto("0.5");
            const errors = await validate(dto);
            expect(errors.length).toBeGreaterThan(0);
        });

        it("should fail with non-numeric string", async () => {
            const dto = createDto("invalid");
            const errors = await validate(dto);
            expect(errors.length).toBeGreaterThan(0);
        });
    });
});
