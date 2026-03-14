import { IsString, Matches } from "class-validator";

export class ConfirmDepositDto {
    @IsString()
    @Matches(/^0x[a-fA-F0-9]{64}$/, { message: "txHash must be a valid transaction hash" })
    txHash: string;
}

export interface ConfirmDepositResponseDto {
    processed: number;
}

export interface DepositTokenDto {
    id: string;
    symbol: string;
    name: string;
    tokenAddress: string;
    decimals: number | null;
    imageUrl: string | null;
    chainId: number | null;
}

export interface BalanceResponseDto {
    balance: string;
    formattedBalance: string;
    decimals: number | null;
    symbol: string;
}
