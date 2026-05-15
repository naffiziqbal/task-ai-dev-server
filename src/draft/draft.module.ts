import { Module } from "@nestjs/common";
import { DraftController } from "./draft.controller";
import { DraftService } from "./draft.service";
import { RetrieveModule } from "../retrieve/retrieve.module";
import { LearningModule } from "../learning/learning.module";

@Module({
  imports: [RetrieveModule, LearningModule],
  controllers: [DraftController],
  providers: [DraftService],
  exports: [DraftService],
})
export class DraftModule {}
