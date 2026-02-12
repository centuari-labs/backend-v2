import { Injectable, BadRequestException } from "@nestjs/common";
import { Token } from "./entities/token.entity";
import { TokensRepository } from "./repositories/tokens.repository";

@Injectable()
export class TokensService {
    constructor(
        private readonly tokenRepository: TokensRepository,
    ) { }

    //@todo : should only load token when first start the service
    /**
     * Validates that a token address exists and is active in the database
     * @throws BadRequestException if token is not supported
     */
    async validateToken(address: string): Promise<Token> {
        const token = await this.tokenRepository.validateToken(address);

        if (!token) {
            throw new BadRequestException(`Token ${address} is not supported`);
        }

        return token;
    }
}
