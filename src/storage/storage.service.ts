import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";

/**
 * DigitalOcean Spaces (S3-compatible) blob storage.
 *
 * Required env:
 *   DO_SPACES_ACCESS_KEY_ID      access key id
 *   DO_SPACES_SECRET_ACCESS_KEY  secret access key
 *   DO_SPACES_REGION             e.g. "nyc3", "sfo3", "ams3", "sgp1", "fra1"
 *   DO_SPACES_BUCKET             bucket name (Space name)
 *   DO_SPACES_ENDPOINT           regional endpoint
 *                                (e.g. https://nyc3.digitaloceanspaces.com)
 *
 * Optional:
 *   DO_SPACES_CDN_BASE   if your Space has the CDN enabled, use this for
 *                        presignGet() to return CDN URLs instead of origin
 *                        (default: presigned origin URL)
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly log = new Logger(StorageService.name);
  private client!: S3Client;
  private bucket!: string;
  private cdnBase: string | null = null;

  async onModuleInit() {
    const key = required("DO_SPACES_ACCESS_KEY_ID");
    const secret = required("DO_SPACES_SECRET_ACCESS_KEY");
    const region = required("DO_SPACES_REGION");
    this.bucket = required("DO_SPACES_BUCKET");
    const endpoint = required("DO_SPACES_ENDPOINT");
    this.cdnBase = process.env.DO_SPACES_CDN_BASE?.replace(/\/+$/, "") ?? null;

    this.client = new S3Client({
      endpoint,
      // AWS SDK requires a region but Spaces ignores its value;
      // sticking with `us-east-1` is the recommended placeholder.
      region: "us-east-1",
      credentials: { accessKeyId: key, secretAccessKey: secret },
      // Spaces uses virtual-hosted-style addressing — keep forcePathStyle off.
      forcePathStyle: false,
    });

    this.log.log(
      `using DigitalOcean Spaces bucket=${this.bucket} endpoint=${endpoint}${
        this.cdnBase ? " (CDN: " + this.cdnBase + ")" : ""
      }`,
    );
  }

  async putBuffer(key: string, body: Buffer, mime?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mime ?? "application/octet-stream",
      }),
    );
  }

  async getBuffer(key: string): Promise<Buffer> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = out.Body;
    if (!body) throw new Error(`storage object empty: ${key}`);
    return streamToBuffer(body as Readable);
  }

  async presignGet(key: string, ttlSeconds = 3600): Promise<string> {
    // If a CDN base is configured, return the CDN URL directly — Spaces'
    // CDN serves public objects without signing. Falls back to a presigned
    // origin URL for private buckets / no-CDN setups.
    if (this.cdnBase) {
      return `${this.cdnBase}/${key
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`;
    }
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set — required for DigitalOcean Spaces storage. ` +
        `Add it to backend/.env.`,
    );
  }
  return v;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
