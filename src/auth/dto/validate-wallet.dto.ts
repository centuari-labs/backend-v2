import { IsNotEmpty, IsString, Matches } from "class-validator";

export class ValidateWalletDto {
    @IsString()
    @IsNotEmpty()
    @Matches(/^0x[a-fA-F0-9]{40}$/, { message: "Invalid wallet address format" })
    wallet_address: string;
}

export interface DepositWalletResponse {
    id: number;
    wallet_address: string;
    paired_wallet_address: string;
    paired_wallet_primary_key: string;
}
