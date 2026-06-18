import { IsString, Length } from "class-validator";

export class UpdateNameDto {
    @IsString()
    @Length(1, 100)
    name: string;
}
