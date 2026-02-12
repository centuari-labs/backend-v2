import {
    registerDecorator,
    ValidationArguments,
    ValidationOptions,
} from "class-validator";
import { validateMaturitiesUtcSeconds } from "../../orders/utils/maturity.utils";

export function IsValidMaturities(validationOptions?: ValidationOptions) {
    return function (object: object, propertyName: string) {
        registerDecorator({
            name: "isValidMaturities",
            target: object.constructor,
            propertyName,
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    if (!Array.isArray(value)) {
                        return false;
                    }
                    if (value.some(v => typeof v !== "number")) {
                        return false;
                    }
                    const { isValid } = validateMaturitiesUtcSeconds(
                        value as number[],
                    );
                    return isValid;
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must contain maturities on the 1st day of the next three calendar months (UTC).`;
                },
            },
        });
    };
}

