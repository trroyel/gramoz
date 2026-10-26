import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/**
 * Cloudflare R2 / S3-Compatible Storage Service
 *
 * Provides secure image uploads, path-traversal prevention, strict MIME-to-extension
 * mapping, and automated deletion across both Cloudflare R2 and local development fallback.
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
    this.publicUrl = this.configService
      .get<string>('R2_PUBLIC_URL', '')
      .replace(/\/+$/, '');

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
   * Upload a file stream to Cloudflare R2 or local disk storage.
   * Derives extension strictly from validated MIME type to prevent extension spoofing.
   */
  async upload(
    fileStream: Readable,
    originalFilename: string,
    mimeType: string,
    folder = 'products',
  ): Promise<string> {
    const normalizedMime = mimeType?.toLowerCase().trim();
    const safeExt = MIME_EXTENSION_MAP[normalizedMime];

    if (!safeExt) {
      throw new BadRequestException(
        `Unsupported file type: ${mimeType}. Only JPEG, PNG, and WebP images are allowed.`,
      );
    }

    // Sanitize folder path against path traversal (reject .., slashes, backslashes)
    const sanitizedFolder = folder.replace(/[^a-zA-Z0-9_-]/g, '') || 'products';
    const key = `${sanitizedFolder}/${randomUUID()}${safeExt}`;

    if (!this.isConfigured || !this.s3) {
      return this.saveLocally(fileStream, key);
    }

    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: fileStream,
        ContentType: normalizedMime,
        ContentDisposition: 'inline',
        ACL: 'public-read',
      },
    });

    await upload.done();
    const url = `${this.publicUrl}/${key}`;
    this.logger.log(`Uploaded to R2: ${url}`);
    return url;
  }

  /**
   * Deletes a previously uploaded file from Cloudflare R2 or local disk.
   * Sanitizes against directory traversal attacks.
   */
  async delete(fileUrl: string): Promise<void> {
    if (!fileUrl || typeof fileUrl !== 'string') return;

    // Prevent path traversal attempts
    if (fileUrl.includes('..')) {
      throw new BadRequestException(
        'Invalid file URL: path traversal detected',
      );
    }

    if (!this.isConfigured || !this.s3) {
      await this.deleteLocally(fileUrl);
      return;
    }

    // Extract object key from public URL
    let key = fileUrl;
    if (this.publicUrl && fileUrl.startsWith(this.publicUrl)) {
      key = fileUrl.slice(this.publicUrl.length).replace(/^\/+/, '');
    } else {
      // Handle generic absolute URLs: e.g. https://domain.com/folder/file.png
      key = fileUrl.replace(/^https?:\/\/[^/]+\//, '');
    }

    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      this.logger.log(`Deleted from R2: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete object from R2 (${key}):`, error);
      throw error;
    }
  }

  /** Local disk fallback for development — saves to ./public/{key} */
  private async saveLocally(stream: Readable, key: string): Promise<string> {
    const dest = path.join(process.cwd(), 'public', key);
    const publicRoot = path.join(process.cwd(), 'public');

    // Ensure destination cannot escape ./public
    if (!dest.startsWith(publicRoot)) {
      throw new BadRequestException('Invalid destination path');
    }

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

  /** Local disk deletion to prevent disk space leaks in development */
  private async deleteLocally(fileUrl: string): Promise<void> {
    const relativeKey = fileUrl.replace(/^\/?public\//, '');
    const dest = path.join(process.cwd(), 'public', relativeKey);
    const publicRoot = path.join(process.cwd(), 'public');

    if (!dest.startsWith(publicRoot)) {
      throw new BadRequestException('Invalid local deletion path');
    }

    try {
      if (fs.existsSync(dest)) {
        await fs.promises.unlink(dest);
        this.logger.log(`Deleted local file: ${dest}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to delete local file ${dest}:`, err);
    }
  }
}
