import {
    registerDecorator,
    ValidationArguments,
    ValidationOptions,
} from "class-validator";

const BYTES32_HEX_REGEX = /^0x[0-9a-fA-F]{64}$/;

/**
 * class-validator decorator asserting that a string is a `0x`-prefixed
 * 32-byte hex value (64 hex chars after the prefix). Used for marketIds in
 * order DTOs post-C4 (was `@IsUUID(undefined)` before the legacy markets
 * table drop).
 */
export function IsBytes32Hex(validationOptions?: ValidationOptions) {
    return (object: object, propertyName: string) => {
        registerDecorator({
            name: "isBytes32Hex",
            target: object.constructor,
            propertyName,
            options: validationOptions,
            validator: {
                validate(value: unknown, _args: ValidationArguments) {
                    return (
                        typeof value === "string" &&
                        BYTES32_HEX_REGEX.test(value)
                    );
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must be a 0x-prefixed bytes32 hex string (0x + 64 hex chars)`;
                },
            },
        });
    };
}
