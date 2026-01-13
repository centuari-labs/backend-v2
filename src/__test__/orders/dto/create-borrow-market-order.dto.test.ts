import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateBorrowMarketOrderDto } from '../../../orders/dto/create-borrow-market-order.dto';

describe('CreateBorrowMarketOrderDto', () => {
    const validDto = {
        loanToken: '0x1234567890abcdef1234567890abcdef12345678',
        amount: '5000',
        maturities: [1704067200],
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

        it('should reject zero maturity value', async () => {
            const dto = createDto({ maturities: [0] });
            const errors = await validate(dto);
            const maturityErrors = errors.filter(e => e.property === 'maturities');
            expect(maturityErrors.length).toBeGreaterThan(0);
        });

        it('should reject negative maturity values', async () => {
            const dto = createDto({ maturities: [-100] });
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
