import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { InterfaceModule } from "./interface/interface.module";
import { CoreModule } from "./core/core.module";
import { OrdersModule } from "./interface/orders/orders.module";

@Module({
    imports: [InterfaceModule, CoreModule, OrdersModule],
    controllers: [AppController],
    providers: [],
})
export class AppModule {}
