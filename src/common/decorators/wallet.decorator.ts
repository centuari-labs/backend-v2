import { createParamDecorator, ExecutionContext } from "@nestjs/common";

/**
 * Parameter decorator to extract the wallet address from the request
 * Requires AuthGuard to be applied to populate request.user
 */
export const Wallet = createParamDecorator(
    (data: unknown, ctx: ExecutionContext): string => {
        const request = ctx.switchToHttp().getRequest();
        return request.user?.walletAddress;
    },
);

/**
 * Full user object including userId and walletAddress
 */
export const CurrentUser = createParamDecorator(
    (data: unknown, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        return request.user;
    },
);
