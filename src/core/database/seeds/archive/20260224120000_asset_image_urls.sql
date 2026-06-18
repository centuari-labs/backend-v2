-- Seed: Populate image_url for known tokens
-- Paths match files in frontend-revamp/public/tokens/

UPDATE assets SET image_url = '/tokens/usdc-icon.svg' WHERE LOWER(symbol) = 'usdc';
UPDATE assets SET image_url = '/tokens/usdt-icon.svg' WHERE LOWER(symbol) = 'usdt';
UPDATE assets SET image_url = '/tokens/xsgd-icon.png' WHERE LOWER(symbol) = 'xsgd';
UPDATE assets SET image_url = '/tokens/idrx-icon.png' WHERE LOWER(symbol) = 'idrx';
UPDATE assets SET image_url = '/tokens/eth-icon.svg' WHERE LOWER(symbol) = 'eth';
UPDATE assets SET image_url = '/tokens/btc-icon.svg' WHERE LOWER(symbol) = 'btc';
UPDATE assets SET image_url = '/tokens/sol-icon.svg' WHERE LOWER(symbol) = 'sol';
UPDATE assets SET image_url = '/tokens/aave-icon.svg' WHERE LOWER(symbol) = 'aave';
