import { Module } from "@nestjs/common";
import { RetrieveService } from "./retrieve.service";
import { RetrieveController } from "./retrieve.controller";

@Module({
  controllers: [RetrieveController],
  providers: [RetrieveService],
  exports: [RetrieveService],
})
export class RetrieveModule {}
