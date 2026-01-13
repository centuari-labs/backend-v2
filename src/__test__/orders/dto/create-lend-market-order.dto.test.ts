import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateLendMarketOrderDto } from '../../../orders/dto/create-lend-market-order.dto';

describe('CreateLendMarketOrderDto', () => {
    const validDto = {
        loanToken: '0x1234567890abcdef1234567890abcdef12345678',
        amount: '1000',
        maturities: [1704067200],
    };

    const createDto = (overrides: Partial<typeof validDto> = {}): CreateLendMarketOrderDto => {
        return plainToInstance(CreateLendMarketOrderDto, { ...validDto, ...overrides });
    };

    describe('market order has no rate field', () => {
        it('should not require rate for market orders', async () => {
            const dto = createDto();
            const errors = await validate(dto);
            expect(errors).toHaveLength(0);
        });

        it('should pass validation even if extra rate field is provided (not validated)', async () => {
            const dto = plainToInstance(CreateLendMarketOrderDto, { ...validDto, rate: 500 });
            const errors = await validate(dto);
            // Rate is not validated for market orders, so no validation error
            expect(errors).toHaveLength(0);
        });
    });

    describe('amount validation', () => {
        it('should accept valid positive numeric string', async () => {
            const dto = createDto({ amount: '1000' });
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

        it('should accept large amount', async () => {
            const dto = createDto({ amount: '1000000000' });
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
            const dto = createDto({ amount: '-100' });
            const errors = await validate(dto);
            const amountErrors = errors.filter(e => e.property === 'amount');
            expect(amountErrors.length).toBeGreaterThan(0);
        });

        it('should reject non-numeric string', async () => {
            const dto = createDto({ amount: 'not-a-number' });
            const errors = await validate(dto);
            const amountErrors = errors.filter(e => e.property === 'amount');
            expect(amountErrors.length).toBeGreaterThan(0);
        });

        it('should reject empty string', async () => {
            const dto = createDto({ amount: '' });
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

    describe('maturities validation', () => {
        it('should accept single maturity', async () => {
            const dto = createDto({ maturities: [1704067200] });
            const errors = await validate(dto);
            const maturityErrors = errors.filter(e => e.property === 'maturities');
            expect(maturityErrors).toHaveLength(0);
        });

        it('should accept multiple maturities', async () => {
            const dto = createDto({ maturities: [1704067200, 1706745600, 1709424000] });
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

        it('should reject non-positive maturity values', async () => {
            const dto = createDto({ maturities: [0] });
            const errors = await validate(dto);
            const maturityErrors = errors.filter(e => e.property === 'maturities');
            expect(maturityErrors.length).toBeGreaterThan(0);
        });

        it('should reject negative maturity values', async () => {
            const dto = createDto({ maturities: [-1704067200] });
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
