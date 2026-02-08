import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ILike, Repository } from "typeorm";
import { Token } from "../entities/token.entity";

@Injectable()
export class TokensRepository {
    constructor(
        @InjectRepository(Token)
        private readonly tokensRepository: Repository<Token>,
    ) { }

    async validateToken(tokenAddress: string): Promise<Token> {
        const token = await this.tokensRepository.findOne({ where: { tokenAddress } });
        if (!token) {
            throw new Error("Token not found");
        }
        return token;
    }

    async getActiveTokens(tokenAddress?: string): Promise<Token[]> {
        return this.tokensRepository.find({ where: { tokenAddress: ILike(`%${tokenAddress}%`) } });
    }
}