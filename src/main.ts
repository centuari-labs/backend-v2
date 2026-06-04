import "dotenv/config";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json, urlencoded } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { runMigrations } from "./core/database/scripts/run-migration";
import { runSeeds } from "./core/database/scripts/run-seed";

async function bootstrap() {
    if (process.env.MIGRATIONS_ON_START === "true") {
        await runMigrations();
    }

    if (process.env.SEED_ON_START === "true") {
        await runSeeds();
    }

    const app = await NestFactory.create(AppModule);
    const logger = new Logger("Bootstrap");

    app.enableShutdownHooks();

    // Security headers (CSP-off by default — this is a JSON API, not HTML).
    app.use(helmet());

    // CORS must fail closed: with `credentials: true`, a wildcard or empty
    // origin is unsafe. Require an explicit allow-list via CORS_ORIGINS.
    const corsOrigins = (process.env.CORS_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);

    if (corsOrigins.length === 0) {
        logger.warn(
            "CORS_ORIGINS is empty — all cross-origin browser requests will be " +
                "rejected. Set CORS_ORIGINS to a comma-separated allow-list.",
        );
    }

    app.enableCors({
        origin: corsOrigins,
        credentials: true,
        methods: ["GET", "POST", "PATCH", "DELETE"],
    });

    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            transform: true,
            forbidNonWhitelisted: true,
        }),
    );

    app.use(json({ limit: "10kb" }));
    app.use(urlencoded({ limit: "10kb", extended: true }));

    await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
