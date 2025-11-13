#!/usr/bin/env ts-node
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Command } from "commander";

const program = new Command();

const exec = (script: string, args: string[] = []) => {
    const scriptPath = join(__dirname, `${script}.ts`);
    spawnSync("ts-node", [scriptPath, ...args], { stdio: "inherit" });
};

program
    .name("db")
    .description("🚀 Centuari Database Migration CLI")
    .version("1.0.0");

program
    .command("create <name>")
    .description("Create a new migration file")
    .action((name) => exec("create-migration", [name]));

program
    .command("up")
    .description("Run all pending migrations")
    .action(() => exec("run-migration"));

program
    .command("down")
    .description("Rollback the last migration")
    .action(() => exec("rollback-migration"));

program
    .command("redo")
    .description("Rollback then rerun the last migration")
    .action(() => exec("redo-migration"));

program
    .command("status")
    .description("Show migration status")
    .action(() => exec("migration-status"));

program
    .command("seed:create <name>")
    .description("Create a new seed file")
    .action((name) => exec("create-seed", [name]));

program
    .command("seed:run")
    .description("Run all seed files")
    .action(() => exec("run-seed"));

program
    .command("reset")
    .description("Reset all migration files")
    .action(() => exec("reset-migration"));

program.parse(process.argv);
