import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getSeedsDir } from "./migrations-dir";

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error(
        "❌ Please provide a seed name, e.g. npm run seed:create seed_users",
    );
    process.exit(1);
}

const name = args[0];
const timestamp = new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);
const filename = `${timestamp}_${name}.sql`;
const filePath = join(getSeedsDir(__dirname), filename);
const template = `-- Seed: ${filename}
BEGIN;

-- Example:
-- INSERT INTO users (name, email)
-- VALUES ('Afrijal Dzuhri', 'afrijal@example.com');

COMMIT;
`;

writeFileSync(filePath, template);
console.log(`✅ Created seed: ${filename}`);
