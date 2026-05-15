import { Module } from "@nestjs/common";
import { StyleRulesController } from "./style-rules.controller";
import { LearningModule } from "../learning/learning.module";

@Module({
  imports: [LearningModule],
  controllers: [StyleRulesController],
})
export class StyleRulesModule {}
