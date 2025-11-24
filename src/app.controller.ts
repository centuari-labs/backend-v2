/** biome-ignore-all lint/correctness/noUnusedFunctionParameters: <explanation> */
/** biome-ignore-all lint/suspicious/noExplicitAny: <explanation> */
import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { PrivyGuard } from "./core/privy/privy.guard";

@Controller()
export class AppController {
    @Get()
    getHello(): string {
        return "Hello World!";
    }

  @Get('me')
  @UseGuards(PrivyGuard)
  async getMe(@Req() req: any) {
      return {
          message: 'Authenticated via Privy!',
          user: req.user,
      };
  }
}
