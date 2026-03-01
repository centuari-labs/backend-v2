import { createParamDecorator, ExecutionContext } from "@nestjs/common";

/**
 * Parameter decorator to extract the raw Bearer token from the Authorization header.
 * Needed for Privy Wallet API's generateUserSigner() which requires the user's JWT.
 */
export const BearerToken = createParamDecorator(
    (data: unknown, ctx: ExecutionContext): string => {
        const request = ctx.switchToHttp().getRequest();
        const authHeader = request.headers.authorization;
        if (!authHeader) return "";
        return authHeader.split(" ")[1] ?? "";
    },
);
