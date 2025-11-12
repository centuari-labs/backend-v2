import { spawnSync } from "node:child_process";

console.log("🔁 Redoing last migration...");

spawnSync("pnpm", ["db", "down"], { stdio: "inherit" });
spawnSync("pnpm", ["db", "up"], { stdio: "inherit" });

console.log("✅ Redo complete!");
