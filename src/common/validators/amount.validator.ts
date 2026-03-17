import {
    registerDecorator,
    ValidationOptions,
    ValidationArguments,
} from "class-validator";

/**
 * Custom validator to check that a string amount is at least a minimum value
 * @param minValue - The minimum numeric value allowed
 */
export function IsMinAmount(
    minValue: number,
    validationOptions?: ValidationOptions,
) {
    return (object: object, propertyName: string) => {
        registerDecorator({
            name: "isMinAmount",
            target: object.constructor,
            propertyName: propertyName,
            options: validationOptions,
            constraints: [minValue],
            validator: {
                validate(value: unknown, args: ValidationArguments) {
                    if (typeof value !== "string") {
                        return false;
                    }
                    const numValue = parseFloat(value);
                    if (isNaN(numValue)) {
                        return false;
                    }
                    const [min] = args.constraints;
                    return numValue >= min;
                },
                defaultMessage(args: ValidationArguments) {
                    const [min] = args.constraints;
                    return `${args.property} must be at least ${min}`;
                },
            },
        });
    };
}

/**
 * Validator to check that a numeric string is positive
 */
export function IsPositiveNumericString(validationOptions?: ValidationOptions) {
    return (object: object, propertyName: string) => {
        registerDecorator({
            name: "isPositiveNumericString",
            target: object.constructor,
            propertyName: propertyName,
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    if (typeof value !== "string") {
                        return false;
                    }
                    const numValue = parseFloat(value);
                    return !isNaN(numValue) && numValue > 0;
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must be a positive number`;
                },
            },
        });
    };
}
