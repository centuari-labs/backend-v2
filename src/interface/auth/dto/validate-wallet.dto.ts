export class ValidateWalletDto {
    wallet_address: string;
}

export interface DepositWalletResponse {
    id: number;
    wallet_address: string;
    paired_wallet_address: string;
    paired_wallet_primary_key: string;
}
