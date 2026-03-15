import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { json, urlencoded } from "express";
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

    app.enableShutdownHooks();

    app.enableCors({
        origin: process.env.CORS_ORIGINS?.split(",") || [],
        credentials: true,
        methods: ["GET", "POST", "PATCH", "DELETE"],
    });

    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());

    app.use(json({ limit: "10kb" }));
    app.use(urlencoded({ limit: "10kb", extended: true }));

    await app.listen(process.env.PORT ?? 3000);
}
bootstrap();