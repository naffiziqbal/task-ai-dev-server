import { Module, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { IngestProcessor } from "./ingest.processor";
import { OcrService } from "./ocr.service";
import { PdfService } from "./pdf.service";
import { ExtractService } from "./extract.service";
import { ChunkService } from "./chunk.service";
import { QueueService, INGEST_QUEUE } from "../queue/queue.service";

@Module({
  providers: [IngestProcessor, OcrService, PdfService, ExtractService, ChunkService],
  exports: [IngestProcessor],
})
export class IngestModule implements OnModuleInit {
  constructor(
    private readonly processor: IngestProcessor,
    private readonly queue: QueueService,
  ) {}

  // Co-locate the BullMQ worker with the API process for now. In production
  // we'd run it as a separate process (src/worker.ts is the entry
  // point for that mode), but co-located keeps the docker-compose simple.
  onModuleInit() {
    if (process.env.DISABLE_INPROCESS_WORKER === "1") return;
    new Worker(
      INGEST_QUEUE,
      async (job) => this.processor.handle(job.data),
      { connection: this.queue.connection, concurrency: 2 },
    );
  }
}
