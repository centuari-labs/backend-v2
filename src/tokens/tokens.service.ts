import { Injectable, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ILike, Repository } from "typeorm";
import { Token } from "./entities/token.entity";

@Injectable()
export class TokensService {
    constructor(
        @InjectRepository(Token)
        private readonly tokenRepository: Repository<Token>,
    ) {}

    /**
     * Validates that a token address exists and is active in the database
     * @throws BadRequestException if token is not supported
     */
    async validateToken(address: string): Promise<Token> {
        const token = await this.tokenRepository.findOne({
            where: { tokenAddress: ILike(address) },
        });

        if (!token) {
            throw new BadRequestException(`Token ${address} is not supported`);
        }

        return token;
    }

    /**
     * Get all active tokens
     */
    async getActiveTokens(): Promise<Token[]> {
        const tokens = await this.tokenRepository.find();
        return tokens;
    }

    /**
     * Check if a token is supported without throwing
     */
    async isTokenSupported(address: string): Promise<boolean> {
        const count = await this.tokenRepository.count({
            where: { tokenAddress: ILike(address) },
        });
        return count > 0;
    }
}
