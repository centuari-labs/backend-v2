import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ILike, Repository } from "typeorm";
import { Token } from "../entities/token.entity";

@Injectable()
export class TokensRepository {
    constructor(
        @InjectRepository(Token)
        private readonly tokensRepository: Repository<Token>,
    ) {}

    async validateToken(tokenAddress: string): Promise<Token | null> {
        return this.tokensRepository.findOne({ where: { tokenAddress } });
    }

    /**
     * Lookup a token by its asset id (primary key on the assets table).
     */
    async findByAssetId(assetId: string): Promise<Token | null> {
        return this.tokensRepository.findOne({ where: { id: assetId } });
    }

    async getActiveTokens(tokenAddress?: string): Promise<Token[]> {
        if (tokenAddress) {
            return this.tokensRepository.find({
                where: { tokenAddress: ILike(`%${tokenAddress}%`) },
            });
        }

        return this.tokensRepository.find();
    }

    /**
     * Return all tokens that are loan tokens (is_loan_token = true).
     */
    async findLoanTokens(): Promise<Token[]> {
        return this.tokensRepository.find({ where: { isLoanToken: true } });
    }

    /**
     * Return all tokens available for deposit.
     */
    async findDepositTokens(): Promise<Token[]> {
        return this.tokensRepository.find();
    }
}
