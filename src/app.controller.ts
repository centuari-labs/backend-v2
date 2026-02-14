import { Controller, Get } from "@nestjs/common";

@Controller("app")
export class AppController {
    @Get("check")
    async check(
    ): Promise<{ status: string }> {
        return { status: 'ok' };
    }
}
