import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue, QueueEvents, ConnectionOptions } from "bullmq";

export const INGEST_QUEUE = "ingest";

export interface IngestJobData {
  documentId: string;
  caseId: string;
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly connection: ConnectionOptions = {
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? 6379),
  };

  readonly ingest = new Queue<IngestJobData>(INGEST_QUEUE, {
    connection: this.connection,
  });

  private events?: QueueEvents;

  async onModuleDestroy() {
    await this.ingest.close();
    await this.events?.close();
  }

  enqueueIngest(data: IngestJobData) {
    return this.ingest.add("ingest", data, {
      removeOnComplete: 100,
      removeOnFail: 100,
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
    });
  }
}
