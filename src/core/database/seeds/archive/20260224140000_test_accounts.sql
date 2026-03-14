-- Seed: 20260224140000_test_accounts.sql
-- Seeds 6 test accounts with specific wallet addresses
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE user_wallet = '0xcA2E021f8FEA9E3fb5F86A68A3158315404e6157') THEN
        INSERT INTO accounts (id, privy_user_id, user_wallet)
        VALUES (gen_random_uuid(), 'did:privy:clx8f2a7k000001', '0xcA2E021f8FEA9E3fb5F86A68A3158315404e6157');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM accounts WHERE user_wallet = '0xAb9A004468A39cCC07e1f62B59F990f45304a222') THEN
        INSERT INTO accounts (id, privy_user_id, user_wallet)
        VALUES (gen_random_uuid(), 'did:privy:clx8f2a7k000002', '0xAb9A004468A39cCC07e1f62B59F990f45304a222');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM accounts WHERE user_wallet = '0x43765641b3632f45366cD91D9F128CFeb34b218F') THEN
        INSERT INTO accounts (id, privy_user_id, user_wallet)
        VALUES (gen_random_uuid(), 'did:privy:clx8f2a7k000003', '0x43765641b3632f45366cD91D9F128CFeb34b218F');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM accounts WHERE user_wallet = '0x103D2146DE8E682ca21eb2fbF9CF9a3e8a127749') THEN
        INSERT INTO accounts (id, privy_user_id, user_wallet)
        VALUES (gen_random_uuid(), 'did:privy:clx8f2a7k000004', '0x103D2146DE8E682ca21eb2fbF9CF9a3e8a127749');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM accounts WHERE user_wallet = '0xCeCe52a44e9e6E57051791E7472CA87b3D789c3e') THEN
        INSERT INTO accounts (id, privy_user_id, user_wallet)
        VALUES (gen_random_uuid(), 'did:privy:clx8f2a7k000005', '0xCeCe52a44e9e6E57051791E7472CA87b3D789c3e');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM accounts WHERE user_wallet = '0xd0c75db43eBa0512D84e6f77104646809f1cac99') THEN
        INSERT INTO accounts (id, privy_user_id, user_wallet)
        VALUES (gen_random_uuid(), 'did:privy:clx8f2a7k000006', '0xd0c75db43eBa0512D84e6f77104646809f1cac99');
    END IF;
END $$;

COMMIT;
