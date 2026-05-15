import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { DbModule } from "./db/db.module";
import { StorageModule } from "./storage/storage.module";
import { QueueModule } from "./queue/queue.module";
import { LlmModule } from "./llm/llm.module";
import { CasesModule } from "./cases/cases.module";
import { DocumentsModule } from "./documents/documents.module";
import { IngestModule } from "./ingest/ingest.module";
import { RetrieveModule } from "./retrieve/retrieve.module";
import { DraftModule } from "./draft/draft.module";
import { LearningModule } from "./learning/learning.module";
import { StyleRulesModule } from "./style-rules/style-rules.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    DbModule,
    AuthModule,
    StorageModule,
    QueueModule,
    LlmModule,
    CasesModule,
    DocumentsModule,
    IngestModule,
    RetrieveModule,
    DraftModule,
    LearningModule,
    StyleRulesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
