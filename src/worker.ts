// Standalone worker entry point. Runs the same Nest module graph as the API
// but does NOT bind an HTTP listener. Use this if you want to scale workers
// independently of the HTTP tier:
//
//   DISABLE_INPROCESS_WORKER=1 pnpm start    # API only
//   pnpm worker                              # worker only
//
// For the default local-first deploy we co-locate worker + HTTP in one
// process and don't need this entry.
import "reflect-metadata";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  // Force the in-process worker on (the API process disables it via env in
  // a split deployment, but workers always run it).
  delete process.env.DISABLE_INPROCESS_WORKER;
  const app = await NestFactory.createApplicationContext(AppModule);
  await app.init();
  console.log("[worker] ready");
  // Keep the process alive — BullMQ Worker holds an event loop ref via its
  // Redis connection, so we just sit here.
}

bootstrap();
