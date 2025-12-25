import { Injectable, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In } from "typeorm";
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
            where: { address: address.toLowerCase(), isActive: true },
        });

        if (!token) {
            throw new BadRequestException(`Token ${address} is not supported`);
        }

        return token;
    }

    /**
     * Validates multiple token addresses exist and are active
     * @throws BadRequestException if any token is not supported
     */
    async validateTokens(addresses: string[]): Promise<Token[]> {
        const normalizedAddresses = addresses.map(addr => addr.toLowerCase());
        
        const tokens = await this.tokenRepository.find({
            where: { 
                address: In(normalizedAddresses), 
                isActive: true 
            },
        });

        const foundAddresses = tokens.map(t => t.address);
        const missingAddresses = normalizedAddresses.filter(
            addr => !foundAddresses.includes(addr)
        );

        if (missingAddresses.length > 0) {
            throw new BadRequestException(
                `The following tokens are not supported: ${missingAddresses.join(", ")}`
            );
        }

        return tokens;
    }

    /**
     * Get all active tokens
     */
    async getActiveTokens(): Promise<Token[]> {
        return this.tokenRepository.find({ where: { isActive: true } });
    }

    /**
     * Check if a token is supported without throwing
     */
    async isTokenSupported(address: string): Promise<boolean> {
        const count = await this.tokenRepository.count({
            where: { address: address.toLowerCase(), isActive: true },
        });
        return count > 0;
    }
}
