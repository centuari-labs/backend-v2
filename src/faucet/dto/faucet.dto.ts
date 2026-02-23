import { IsNumber, IsString, IsNotEmpty } from "class-validator";

export class RequestTokenDto {
    @IsNumber()
    chainId: number;

    @IsString()
    @IsNotEmpty()
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
