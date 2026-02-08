import { Entity, PrimaryColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Token } from '../../tokens/entities/token.entity';

@Entity('markets')
export class Market {
    @PrimaryColumn('uuid')
    id: string;

    @Column({ name: 'asset_id', type: 'uuid' })
    assetId: string;

    @ManyToOne(() => Token)
    @JoinColumn({ name: 'asset_id' })
    asset: Token;

    @Column({ type: 'timestamp', nullable: true })
    maturity: Date;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
