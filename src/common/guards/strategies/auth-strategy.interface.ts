export interface AuthUser {
    userId: string;
    walletAddress: string;
}

export interface IAuthStrategy {
    validate(token: string): Promise<AuthUser>;
    getName(): string;
}
