-- Realign assets.token_address on Arbitrum Sepolia (chainId 421614)
-- to match the freshly-deployed mock tokens in
-- smart-contract-revamp/deployments/deploy-arb-sepolia-latest.json.
--
-- Why: the original 20260120 seed pre-dates the 2026-05-04 redeploy of
-- the mock-token + HubDepositor stack. HubDepositor._supportedAssets is
-- the on-chain source of truth and was configured from the deploy JSON,
-- so the DB must follow it or every deposit reverts with UnsupportedAsset.
BEGIN;
UPDATE assets SET token_address = '0x218A9082C712FA709c044a6cea6Ef333df04cc3d' WHERE symbol = 'USDC'   AND chain_id = 421614;
UPDATE assets SET token_address = '0xc3Ab74D13A2b03d66E9b5a5Eda8b3F2Fea52Fc12' WHERE symbol = 'USDT'   AND chain_id = 421614;
UPDATE assets SET token_address = '0x86B3405275F5fCb90f98a12C18E619f134F6521a' WHERE symbol = 'IDRX'   AND chain_id = 421614;
UPDATE assets SET token_address = '0x9aeDd0ff1178e33Ad6d30F858ddB98115F9c0293' WHERE symbol = 'XSGD'   AND chain_id = 421614;
UPDATE assets SET token_address = '0x73Bc0536aDF10110233e67D1bdd98580A5255494' WHERE symbol = 'BTC'    AND chain_id = 421614;
UPDATE assets SET token_address = '0x22BEE7B9f4DC7923190B3e3BE795f5905c62F00c' WHERE symbol = 'ETH'    AND chain_id = 421614;
UPDATE assets SET token_address = '0x2544Ce3FF3540EEeADBB6FA19709b8fAd83441F4' WHERE symbol = 'XAUT'   AND chain_id = 421614;
UPDATE assets SET token_address = '0x47757F5C6109032019a8316F3550A1F5Dd2196D9' WHERE symbol = 'SLVon'  AND chain_id = 421614;
UPDATE assets SET token_address = '0x75f23E36c2011d8AD580b5D62Ed131c58F2D7FE2' WHERE symbol = 'NVDAon' AND chain_id = 421614;
UPDATE assets SET token_address = '0x9f4aCe64eB5Aa003c39F85ab10EE3d2f0f102A34' WHERE symbol = 'AAPLon' AND chain_id = 421614;
UPDATE assets SET token_address = '0x8A7d5D4A1B7feFb055930d4D9e8d6A92c068414f' WHERE symbol = 'TLTon'  AND chain_id = 421614;
COMMIT;
