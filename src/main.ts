import "reflect-metadata";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env before any module reads process.env. Node 20.12+ has this natively.
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: true,
  });

  // Required when running behind Nginx so Express sees the original https
  // scheme and client IP via X-Forwarded-* headers.
  app.set("trust proxy", 1);

  app.use((req: any, res: any, next: any) => {
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      console.log(
        `[req] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms) origin=${req.headers.origin ?? "-"}`,
      );
    });
    next();
  });

  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);

  console.log(`[api] listening on http://localhost:${port}`);
}

bootstrap();
