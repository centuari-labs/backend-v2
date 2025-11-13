import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { InterfaceModule } from "./interface/interface.module";

@Module({
    imports: [InterfaceModule],
    controllers: [AppController],
    providers: [],
})
export class AppModule {}
