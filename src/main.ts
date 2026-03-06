import "dotenv/config";
import { NestFactory } from "@nestjs/core";
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

    app.enableCors();

    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.listen(process.env.PORT ?? 3000);
}
bootstrap();


//@todo : fix live query tables in production