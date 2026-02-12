import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateBorrowMarketOrderDto } from '../../../orders/dto/create-borrow-market-order.dto';
import { getAllowedMaturitiesUtcSeconds } from '../../../orders/utils/maturity.utils';

describe('CreateBorrowMarketOrderDto', () => {
    const fixedNow = new Date(Date.UTC(2026, 1, 15, 0, 0, 0)); // 2026-02-15 UTC
    const allowedMaturities = getAllowedMaturitiesUtcSeconds(fixedNow);

    const validDto = {
        assetId: 'b66a2641-3339-4a48-805c-6da248f33dee',
        amount: '5000',
        maturities: [allowedMaturities[0]],
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

    describe('maturities validation (Unix timestamps in seconds)', () => {
        it('should accept single maturity timestamp within next three months on day 1', async () => {
            const dto = createDto({ maturities: [allowedMaturities[0]] });
            const errors = await validate(dto);
            const maturityErrors = errors.filter(e => e.property === 'maturities');
            expect(maturityErrors).toHaveLength(0);
        });

        it('should accept multiple maturity timestamps that are allowed first-of-month dates', async () => {
            const dto = createDto({ maturities: allowedMaturities });
            const errors = await validate(dto);
            const maturityErrors = errors.filter(e => e.property === 'maturities');
            expect(maturityErrors).toHaveLength(0);
        });

        it('should reject empty maturities array', async () => {
            const dto = createDto({ maturities: [] });
            const errors = await validate(dto);
            const maturityErrors = errors.filter(e => e.property === 'maturities');
            expect(maturityErrors.length).toBeGreaterThan(0);
        });

        it('should reject zero maturity timestamp value', async () => {
            const dto = createDto({ maturities: [0] });
            const errors = await validate(dto);
            const maturityErrors = errors.filter(e => e.property === 'maturities');
            expect(maturityErrors.length).toBeGreaterThan(0);
        });

        it('should reject negative maturity timestamp values', async () => {
            const dto = createDto({ maturities: [-100] });
            const errors = await validate(dto);
            const maturityErrors = errors.filter(e => e.property === 'maturities');
            expect(maturityErrors.length).toBeGreaterThan(0);
        });

        it('should reject non-integer maturity timestamp values', async () => {
            const dto = createDto({ maturities: [allowedMaturities[0] + 0.5 as any] });
            const errors = await validate(dto);
            const maturityErrors = errors.filter(e => e.property === 'maturities');
            expect(maturityErrors.length).toBeGreaterThan(0);
        });

        it('should reject maturities not on the 1st of a month', async () => {
            const invalid = allowedMaturities[0] + 24 * 60 * 60;
            const dto = createDto({ maturities: [invalid] });
            const errors = await validate(dto);
            const maturityErrors = errors.filter(e => e.property === 'maturities');
            expect(maturityErrors.length).toBeGreaterThan(0);
        });

        it('should reject maturities beyond the next three calendar months', async () => {
            const beyond = allowedMaturities[2] + 31 * 24 * 60 * 60;
            const dto = createDto({ maturities: [beyond] });
            const errors = await validate(dto);
            const maturityErrors = errors.filter(e => e.property === 'maturities');
            expect(maturityErrors.length).toBeGreaterThan(0);
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
