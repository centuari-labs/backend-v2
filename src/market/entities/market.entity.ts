import { Entity, PrimaryColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Token } from '../../tokens/entities/token.entity';

@Entity('markets')
@Unique(['assetId', 'maturity'])
export class Market {
    @PrimaryColumn('uuid')
    id: string;

    @Column({ name: 'asset_id', type: 'uuid' })
    assetId: string;

    @ManyToOne(() => Token)
    @JoinColumn({ name: 'asset_id' })
    asset: Token;

    @Column({ type: 'timestamptz', nullable: true })
    maturity: Date;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
