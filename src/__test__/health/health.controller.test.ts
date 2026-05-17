import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, HttpStatus } from "@nestjs/common";
import request from "supertest";
import { App } from "supertest/types";
import { ResponseInterceptor } from "src/common/interceptors/response.interceptor";
import { HealthController } from "src/health/health.controller";

describe("HealthController", () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [HealthController],
        }).compile();

        app = module.createNestApplication();
        app.useGlobalInterceptors(new ResponseInterceptor());
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    it("GET /health returns 200 with status ok", async () => {
        const res = await request(app.getHttpServer()).get("/health");
        expect(res.status).toBe(HttpStatus.OK);
        expect(res.body.data.status).toBe("ok");
    });

    it("GET /health returns 200 without Authorization header", async () => {
        const res = await request(app.getHttpServer())
            .get("/health")
            .set("Authorization", "");
        expect(res.status).toBe(HttpStatus.OK);
    });
});
