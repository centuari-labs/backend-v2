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

    async validateToken(tokenAddress: string): Promise<Token | null> {
        return this.tokensRepository.findOne({ where: { tokenAddress } });
    }

    async findById(id: string): Promise<Token | null> {
        return this.tokensRepository.findOne({
            where: { id },
            select: ['id', 'tokenAddress'],
        });
    }

    async getActiveTokens(tokenAddress?: string): Promise<Token[]> {
        if (tokenAddress) {
            return this.tokensRepository.find({
                where: { tokenAddress: ILike(`%${tokenAddress}%`) },
            });
        }

        return this.tokensRepository.find();
    }
}