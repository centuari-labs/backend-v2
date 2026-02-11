import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateBorrowLimitOrderDto } from '../../../orders/dto/create-borrow-limit-order.dto';

describe('CreateBorrowLimitOrderDto', () => {
    const validDto = {
        loanToken: '0x1234567890abcdef1234567890abcdef12345678',
        amount: '1000',
        maturities: [1704067200],
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

    describe('loanToken validation', () => {
        it('should accept valid token address', async () => {
            const dto = createDto();
            const errors = await validate(dto);
            const tokenErrors = errors.filter(e => e.property === 'loanToken');
            expect(tokenErrors).toHaveLength(0);
        });

        it('should reject empty loanToken', async () => {
            const dto = createDto({ loanToken: '' });
            const errors = await validate(dto);
            const tokenErrors = errors.filter(e => e.property === 'loanToken');
            expect(tokenErrors.length).toBeGreaterThan(0);
        });
    });

    describe('maturities validation (Unix timestamps in seconds)', () => {
        it('should accept single maturity timestamp', async () => {
            const dto = createDto({ maturities: [1704067200] });
            const errors = await validate(dto);
            const maturityErrors = errors.filter(e => e.property === 'maturities');
            expect(maturityErrors).toHaveLength(0);
        });

        it('should accept multiple maturity timestamps', async () => {
            const dto = createDto({ maturities: [1704067200, 1706745600] });
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
            const dto = createDto({ maturities: [1704067200.5 as any] });
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
