import { IsString, IsOptional, IsNotEmpty } from "class-validator";

export class CreateOrderGroupDto {
    @IsString()
    @IsNotEmpty()
    wallet_address: string;

    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    description?: string;
}
