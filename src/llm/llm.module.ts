import { Global, Module } from "@nestjs/common";
import { LlmService } from "./llm.service";
import { EmbeddingService } from "./embedding.service";

@Global()
@Module({
  providers: [LlmService, EmbeddingService],
  exports: [LlmService, EmbeddingService],
})
export class LlmModule {}
