import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateBorrowLimitOrderDto } from '../../../orders/dto/create-borrow-limit-order.dto';
import { getAllowedMaturitiesUtcSeconds } from '../../../orders/utils/maturity.utils';

describe('CreateBorrowLimitOrderDto', () => {
    const fixedNow = new Date(Date.UTC(2026, 1, 15, 0, 0, 0)); // 2026-02-15 UTC
    const allowedMaturities = getAllowedMaturitiesUtcSeconds(fixedNow);

    const validDto = {
        assetId: 'b66a2641-3339-4a48-805c-6da248f33dee',
        amount: '1000',
        maturities: [allowedMaturities[0]],
        rate: 500, // 5% in basis points
    };

    const createDto = (overrides: Partial<typeof validDto> = {}): CreateBorrowLimitOrderDto => {
        return plainToInstance(CreateBorrowLimitOrderDto, { ...validDto, ...overrides });
    };

    describe('rate validation', () => {
        it('should accept exactly 1 basis point (0.01%)', async () => {
            const dto = createDto({ rate: 1 });
            const errors = await validate(dto);
            const rateErrors = errors.filter(e => e.property === 'rate');
            expect(rateErrors).toHaveLength(0);
        });

        it('should accept exactly 10000 basis points (100%)', async () => {
            const dto = createDto({ rate: 10000 });
            const errors = await validate(dto);
            const rateErrors = errors.filter(e => e.property === 'rate');
            expect(rateErrors).toHaveLength(0);
        });

        it('should accept rate within valid range (750 bp = 7.5%)', async () => {
            const dto = createDto({ rate: 750 });
            const errors = await validate(dto);
            const rateErrors = errors.filter(e => e.property === 'rate');
            expect(rateErrors).toHaveLength(0);
        });

        it('should reject 0 basis points', async () => {
            const dto = createDto({ rate: 0 });
            const errors = await validate(dto);
            const rateErrors = errors.filter(e => e.property === 'rate');
            expect(rateErrors.length).toBeGreaterThan(0);
            expect(rateErrors[0].constraints).toHaveProperty('min');
        });

        it('should reject negative rate', async () => {
            const dto = createDto({ rate: -50 });
            const errors = await validate(dto);
            const rateErrors = errors.filter(e => e.property === 'rate');
            expect(rateErrors.length).toBeGreaterThan(0);
        });

        it('should reject rate exceeding 10000 basis points', async () => {
            const dto = createDto({ rate: 10001 });
            const errors = await validate(dto);
            const rateErrors = errors.filter(e => e.property === 'rate');
            expect(rateErrors.length).toBeGreaterThan(0);
            expect(rateErrors[0].constraints).toHaveProperty('max');
        });

        it('should reject extremely high rate (20000 bp)', async () => {
            const dto = createDto({ rate: 20000 });
            const errors = await validate(dto);
            const rateErrors = errors.filter(e => e.property === 'rate');
            expect(rateErrors.length).toBeGreaterThan(0);
        });

        it('should reject non-integer rate', async () => {
            const dto = createDto({ rate: 7.25 as any });
            const errors = await validate(dto);
            const rateErrors = errors.filter(e => e.property === 'rate');
            expect(rateErrors.length).toBeGreaterThan(0);
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
            const dto = createDto({ amount: '1000.50' });
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
            const dto = createDto({ amount: '-500' });
            const errors = await validate(dto);
            const amountErrors = errors.filter(e => e.property === 'amount');
            expect(amountErrors.length).toBeGreaterThan(0);
        });

        it('should reject non-numeric string', async () => {
            const dto = createDto({ amount: 'invalid' });
            const errors = await validate(dto);
            const amountErrors = errors.filter(e => e.property === 'amount');
            expect(amountErrors.length).toBeGreaterThan(0);
        });

        it('should reject amount less than minimum', async () => {
            const dto = createDto({ amount: '0.5' });
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

        it('should reject non-positive maturity timestamp values', async () => {
            const dto = createDto({ maturities: [0] });
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

        it('should fail with multiple invalid fields', async () => {
            const dto = createDto({ rate: 0, amount: '-100', maturities: [] });
            const errors = await validate(dto);
            expect(errors.length).toBeGreaterThan(1);
        });
    });
});
