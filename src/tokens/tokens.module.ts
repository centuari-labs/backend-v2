import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Token } from "./entities/token.entity";
import { TokensService } from "./tokens.service";
import { TokensRepository } from "./repositories/tokens.repository";

@Module({
    imports: [TypeOrmModule.forFeature([Token])],
    providers: [TokensService, TokensRepository],
    exports: [TokensService, TokensRepository],
})
export class TokensModule { }
