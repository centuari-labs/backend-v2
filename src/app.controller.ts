import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { type Request } from "express";
import { PrivyGuard } from "./core/privy/privy.guard";

@Controller()
export class AppController {
    @Get()
    getHello(): string {
        return "Hello World!";
    }

    @Get("me")
    @UseGuards(PrivyGuard)
    async getMe(
        @Req() req: Request & { user: Record<string, string | number> },
    ) {
        return {
            message: "Authenticated via Privy!",
            user: req.user,
        };
    }
}
