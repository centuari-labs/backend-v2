import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { CoreModule } from "./core/core.module";
import { InterfaceModule } from "./interface/interface.module";

@Module({
    imports: [InterfaceModule, CoreModule],
    controllers: [AppController],
    providers: [],
})
export class AppModule {}
