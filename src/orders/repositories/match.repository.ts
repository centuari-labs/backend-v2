import { Injectable } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";
import { Match } from "../entities/match.entity";

@Injectable()
export class MatchRepository extends Repository<Match> {
    constructor(private dataSource: DataSource) {
        super(Match, dataSource.createEntityManager());
    }

    /**
     * FILLED-but-unsettled borrow matches for a given account. The matching
     * engine flips an order to FILLED as soon as it matches; settlement-engine
     * later writes the `borrow_position` row and stamps
     * `matches.settlement_status = 'SETTLED'` (Phase 1A writeback). The window
     * between those two events is normally tens of seconds, but during that
     * window the debt is in neither bucket — not in OPEN/PARTIALLY_FILLED
     * orders, not in `borrow_position`. Place-order HF reads this list and
     * folds each pending match into the prospective debt total to keep a
     * second borrow from sneaking under-collateralised against the same
     * collateral.
     *
     * Backed by the `idx_matches_borrower_settlement_status` index added in
     * the Phase 1A migration.
     */
    async getPendingBorrowMatches(
        accountId: string,
    ): Promise<{ assetId: string; matchAmount: string }[]> {
        return this.createQueryBuilder("m")
            .select("m.asset_id", "assetId")
            .addSelect("m.match_amount", "matchAmount")
            .where("m.borrower_account_id = :accountId", { accountId })
            .andWhere("m.settlement_status = :status", { status: "PENDING" })
            .getRawMany();
    }
}
