-- Seed: 20260315120000_update_token_images_to_webp.sql
BEGIN;

-- Update all token asset image URLs to WebP format
UPDATE assets SET image_url = '/tokens/btc-icon.webp' WHERE symbol = 'BTC';
UPDATE assets SET image_url = '/tokens/eth-icon.webp' WHERE symbol = 'ETH';
UPDATE assets SET image_url = '/tokens/xaut-icon.webp' WHERE symbol = 'XAUT';
UPDATE assets SET image_url = '/tokens/usdc-icon.webp' WHERE symbol = 'USDC';
UPDATE assets SET image_url = '/tokens/usdt-icon.webp' WHERE symbol = 'USDT';
UPDATE assets SET image_url = '/tokens/idrx-icon.webp' WHERE symbol = 'IDRX';
UPDATE assets SET image_url = '/tokens/xsgd-icon.webp' WHERE symbol = 'XSGD';
UPDATE assets SET image_url = '/tokens/slvon-icon.webp' WHERE symbol = 'SLVon';
UPDATE assets SET image_url = '/tokens/nvda-icon.webp' WHERE symbol = 'NVDAon';
UPDATE assets SET image_url = '/tokens/aaplon-icon.webp' WHERE symbol = 'AAPLon';
UPDATE assets SET image_url = '/tokens/tlton-icon.webp' WHERE symbol = 'TLTon';

COMMIT;
