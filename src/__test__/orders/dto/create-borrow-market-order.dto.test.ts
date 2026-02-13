import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateBorrowMarketOrderDto } from '../../../orders/dto/create-borrow-market-order.dto';

describe('CreateBorrowMarketOrderDto', () => {
    const validDto = {
        assetId: 'b66a2641-3339-4a48-805c-6da248f33dee',
        amount: '5000',
        marketIds: ['550e8400-e29b-41d4-a716-446655440000'],
    };

    const createDto = (overrides: Partial<typeof validDto> = {}): CreateBorrowMarketOrderDto => {
        return plainToInstance(CreateBorrowMarketOrderDto, { ...validDto, ...overrides });
    };

    describe('market order has no rate field', () => {
        it('should not require rate for market orders', async () => {
            const dto = createDto();
            const errors = await validate(dto);
            expect(errors).toHaveLength(0);
        });

        it('should pass validation even if extra rate field is provided (not validated)', async () => {
            const dto = plainToInstance(CreateBorrowMarketOrderDto, { ...validDto, rate: 750 });
            const errors = await validate(dto);
            // Rate is not validated for market orders, so no validation error
            expect(errors).toHaveLength(0);
        });
    });

    describe('amount validation', () => {
        it('should accept valid positive numeric string', async () => {
            const dto = createDto({ amount: '5000' });
            const errors = await validate(dto);
            const amountErrors = errors.filter(e => e.property === 'amount');
            expect(amountErrors).toHaveLength(0);
        });

        it('should accept amount exactly at minimum (1 USD)', async () => {
            const dto = createDto({ amount: '1' });
            const errors = await validate(dto);
            const amountErrors = errors.filter(e => e.property === 'amount');
            expect(amountErrors).toHaveLength(0);
        });

        it('should accept decimal amount', async () => {
            const dto = createDto({ amount: '1000.75' });
            const errors = await validate(dto);
            const amountErrors = errors.filter(e => e.property === 'amount');
            expect(amountErrors).toHaveLength(0);
        });

        it('should reject zero amount', async () => {
            const dto = createDto({ amount: '0' });
            const errors = await validate(dto);
            const amountErrors = errors.filter(e => e.property === 'amount');
            expect(amountErrors.length).toBeGreaterThan(0);
        });

        it('should reject negative amount', async () => {
            const dto = createDto({ amount: '-5000' });
            const errors = await validate(dto);
            const amountErrors = errors.filter(e => e.property === 'amount');
            expect(amountErrors.length).toBeGreaterThan(0);
        });

        it('should reject non-numeric string', async () => {
            const dto = createDto({ amount: 'borrow-amount' });
            const errors = await validate(dto);
            const amountErrors = errors.filter(e => e.property === 'amount');
            expect(amountErrors.length).toBeGreaterThan(0);
        });

        it('should reject amount below minimum', async () => {
            const dto = createDto({ amount: '0.99' });
            const errors = await validate(dto);
            const amountErrors = errors.filter(e => e.property === 'amount');
            expect(amountErrors.length).toBeGreaterThan(0);
        });
    });

    describe('assetId validation', () => {
        it('should accept valid asset id', async () => {
            const dto = createDto();
            const errors = await validate(dto);
            const tokenErrors = errors.filter(e => e.property === 'assetId');
            expect(tokenErrors).toHaveLength(0);
        });

        it('should reject empty assetId', async () => {
            const dto = createDto({ assetId: '' });
            const errors = await validate(dto);
            const tokenErrors = errors.filter(e => e.property === 'assetId');
            expect(tokenErrors.length).toBeGreaterThan(0);
        });
    });

    describe('marketIds validation (UUID array)', () => {
        it('should accept a single valid marketId', async () => {
            const dto = createDto({ marketIds: ['550e8400-e29b-41d4-a716-446655440000'] });
            const errors = await validate(dto);
            const marketIdErrors = errors.filter(e => e.property === 'marketIds');
            expect(marketIdErrors).toHaveLength(0);
        });

        it('should accept multiple valid marketIds', async () => {
            const dto = createDto({
                marketIds: [
                    '550e8400-e29b-41d4-a716-446655440000',
                    '123e4567-e89b-12d3-a456-426614174000',
                ],
            });
            const errors = await validate(dto);
            const marketIdErrors = errors.filter(e => e.property === 'marketIds');
            expect(marketIdErrors).toHaveLength(0);
        });

        it('should reject empty marketIds array', async () => {
            const dto = createDto({ marketIds: [] });
            const errors = await validate(dto);
            const marketIdErrors = errors.filter(e => e.property === 'marketIds');
            expect(marketIdErrors.length).toBeGreaterThan(0);
        });

        it('should reject non-UUID marketIds', async () => {
            const dto = createDto({ marketIds: ['not-a-uuid'] as any });
            const errors = await validate(dto);
            const marketIdErrors = errors.filter(e => e.property === 'marketIds');
            expect(marketIdErrors.length).toBeGreaterThan(0);
        });
    });

    describe('complete dto validation', () => {
        it('should pass validation with all valid fields', async () => {
            const dto = createDto();
            const errors = await validate(dto);
            expect(errors).toHaveLength(0);
        });
    });
});
