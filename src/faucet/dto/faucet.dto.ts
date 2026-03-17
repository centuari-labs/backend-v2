import {
    IsNumber,
    IsString,
    IsNotEmpty,
    IsPositive,
    Matches,
} from "class-validator";

export class RequestTokenDto {
    @IsNumber()
    @IsPositive()
    chainId: number;

    @IsString()
    @IsNotEmpty()
    @Matches(/^0x[a-fA-F0-9]{40}$/, { message: "Invalid wallet address format" })
    recipientAddress: string;

    @IsNotEmpty()
    token: string | string[];
}

export class TokenMintResultDto {
    tokenAddress: string;
    amount: string;
}

export class FaucetResponseDto {
    chainId: number;
    recipientAddress: string;
    transactionHash: string;
    blockNumber: string;
    status: string;
    results: TokenMintResultDto[];
}
