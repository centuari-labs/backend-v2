-- Seed: 20260315120000_update_token_images_to_webp.sql
BEGIN;

-- Update all token asset image URLs to WebP format
UPDATE assets SET image_url = 'https://cryptologos.cc/logos/bitcoin-btc-logo.webp'
    WHERE symbol = 'BTC';

UPDATE assets SET image_url = 'https://cryptologos.cc/logos/ethereum-eth-logo.webp'
    WHERE symbol = 'ETH';

UPDATE assets SET image_url = 'https://cryptologos.cc/logos/tether-gold-xaut-logo.webp'
    WHERE symbol = 'XAUT';

UPDATE assets SET image_url = 'https://cryptologos.cc/logos/usd-coin-usdc-logo.webp'
    WHERE symbol = 'USDC';

UPDATE assets SET image_url = 'https://example.com/idrx.webp'
    WHERE symbol = 'IDRX';

UPDATE assets SET image_url = 'https://example.com/xsgd.webp'
    WHERE symbol = 'XSGD';

UPDATE assets SET image_url = 'https://example.com/kag.webp'
    WHERE symbol = 'KAG';

UPDATE assets SET image_url = 'https://example.com/nvdax.webp'
    WHERE symbol = 'NVDAX';

UPDATE assets SET image_url = 'https://example.com/tslax.webp'
    WHERE symbol = 'TSLAX';

UPDATE assets SET image_url = 'https://example.com/ousg.webp'
    WHERE symbol = 'OUSG';

COMMIT;
