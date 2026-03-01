import { IsNotEmpty, IsString } from "class-validator";
import {
    IsPositiveNumericString,
} from "../../common/validators/amount.validator";

export class CreateDepositDto {
    @IsString()
    @IsNotEmpty()
    assetId: string;

    @IsString()
    @IsNotEmpty()
    @IsPositiveNumericString({
        message: "amount must be a valid positive number",
    })
    amount: string;
}

export interface DepositResponseDto {
    transactionHash: string;
    status: string;
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
