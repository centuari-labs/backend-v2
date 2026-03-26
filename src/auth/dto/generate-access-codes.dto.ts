import {
    IsDateString,
    IsInt,
    IsOptional,
    IsString,
    Max,
    Min,
} from "class-validator";

export class GenerateAccessCodesDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(50)
    count?: number;

    @IsOptional()
    @IsInt()
    @Min(-1)
    max_uses?: number;

    @IsOptional()
    @IsDateString()
    expires_at?: string;

    @IsOptional()
    @IsString()
    prefix?: string;
}
