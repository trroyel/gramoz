import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import { extname } from 'path';
import { randomUUID } from 'crypto';

/**
 * Cloudflare R2 Upload Service
 *
 * R2 is S3-compatible, so we use the AWS SDK with a custom endpoint.
 *
 * Required env vars:
 *   R2_ACCOUNT_ID     — Cloudflare account ID (from dashboard URL)
 *   R2_ACCESS_KEY_ID  — R2 API token Access Key ID
 *   R2_SECRET_ACCESS_KEY — R2 API token Secret Access Key
 *   R2_BUCKET         — name of your R2 bucket (e.g. "gramoz-media")
 *   R2_PUBLIC_URL     — public URL prefix (e.g. https://media.gramoz.com)
 *
 * How to get credentials:
 *   1. Go to Cloudflare Dashboard → R2 → Manage R2 API Tokens
 *   2. Create token with "Object Read & Write" permission on your bucket
 *   3. Copy Account ID from the R2 overview page
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client | null = null;
  private readonly bucket: string;
  private readonly publicUrl: string;
  private readonly isConfigured: boolean;

  constructor(private readonly configService: ConfigService) {
    const accountId = this.configService.get<string>('R2_ACCOUNT_ID', '');
    const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID', '');
    const secretAccessKey = this.configService.get<string>(
      'R2_SECRET_ACCESS_KEY',
      '',
    );

    this.bucket = this.configService.get<string>('R2_BUCKET', 'gramoz-media');
    this.publicUrl = this.configService.get<string>('R2_PUBLIC_URL', '');

    this.isConfigured = Boolean(accountId && accessKeyId && secretAccessKey);

    if (this.isConfigured) {
      this.s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
      this.logger.log('Cloudflare R2 storage configured');
    } else {
      this.logger.warn(
        'R2 credentials not configured — falling back to local disk uploads',
      );
    }
  }

  /**
   * Upload a file stream to R2 and return the public URL.
   * Falls back to local disk if R2 is not configured (dev environment).
   */
  async upload(
    fileStream: Readable,
    originalFilename: string,
    mimeType: string,
  ): Promise<string> {
    const ext = extname(originalFilename).toLowerCase();
    const key = `products/${randomUUID()}${ext}`;

    if (!this.isConfigured || !this.s3) {
      return this.saveLocally(fileStream, key);
    }

    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: fileStream,
        ContentType: mimeType,
        // Files are publicly readable via the custom domain
        ACL: 'public-read',
      },
    });

    await upload.done();
    const url = `${this.publicUrl}/${key}`;
    this.logger.log(`Uploaded to R2: ${url}`);
    return url;
  }

  /** Delete a previously uploaded file from R2 */
  async delete(fileUrl: string): Promise<void> {
    if (!this.isConfigured || !this.s3) return;

    // Extract the key from the full URL
    const key = fileUrl.replace(`${this.publicUrl}/`, '');
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    this.logger.log(`Deleted from R2: ${key}`);
  }

  /** Local disk fallback for development — saves to ./public/uploads */
  private async saveLocally(stream: Readable, key: string): Promise<string> {
    const fs = await import('fs');
    const path = await import('path');

    const dest = path.join(process.cwd(), 'public', key);
    const dir = path.dirname(dest);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(dest);
      stream.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const localPath = `/public/${key}`;
    this.logger.warn(`Saved locally (R2 not configured): ${localPath}`);
    return localPath;
  }
}
