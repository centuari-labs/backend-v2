import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { runMigrations } from "./core/database/scripts/run-migration";

async function bootstrap() {
    //@todo : make testnet token seed always run when NODE_ENV is development
    //@todo : make testnet seed data always run when NODE_ENV is development
    //@todo : make production token seed always run when NODE_ENV is production
    await runMigrations();

    const app = await NestFactory.create(AppModule);

    app.enableCors();

    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
