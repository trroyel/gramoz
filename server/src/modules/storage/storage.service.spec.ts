import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import { Readable } from 'stream';
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

// Mock @aws-sdk/lib-storage Upload
const mockUploadDone = jest.fn();
jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation(() => ({
    done: mockUploadDone,
  })),
}));

// Mock @aws-sdk/client-s3
const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: mockS3Send,
  })),
  DeleteObjectCommand: jest
    .fn()
    .mockImplementation((args: unknown) => args as Record<string, unknown>),
}));

describe('StorageService (Cloudflare R2 & Local Disk — TASK-24 / B-STR-01)', () => {
  let service: StorageService;
  let mockConfigService: any;
  const createdLocalFiles: string[] = [];

  const createMockStream = (content = 'fake-image-bytes'): Readable => {
    return Readable.from([Buffer.from(content)]);
  };

  afterAll(async () => {
    // Cleanup any local test files created during test runs
    for (const file of createdLocalFiles) {
      if (fs.existsSync(file)) {
        try {
          await fs.promises.unlink(file);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  });

  describe('Local Disk Fallback Mode (Unconfigured R2)', () => {
    beforeEach(async () => {
      mockConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'R2_BUCKET') return 'gramoz-media';
          if (key === 'R2_PUBLIC_URL') return '';
          return ''; // R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY empty
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StorageService,
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      service = module.get(StorageService);
    });

    it('saves file stream to local public directory and returns relative URL', async () => {
      const stream = createMockStream('test-jpeg-content');
      const url = await service.upload(
        stream,
        'photo.jpg',
        'image/jpeg',
        'products',
      );

      expect(url).toMatch(/^\/public\/products\/[a-f0-9-]+\.jpg$/);

      const filePath = path.join(process.cwd(), url.slice(1));
      createdLocalFiles.push(filePath);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('enforces safe extension from MIME type even if filename has spoofed extension', async () => {
      const stream = createMockStream('test-jpeg-content');
      // Attacker names file 'payload.php' or 'script.html' with image/jpeg MIME type
      const url = await service.upload(
        stream,
        'payload.php',
        'image/jpeg',
        'products',
      );

      // Must be forced to .jpg
      expect(url.endsWith('.jpg')).toBe(true);
      expect(url).not.toContain('.php');

      const filePath = path.join(process.cwd(), url.slice(1));
      createdLocalFiles.push(filePath);
    });

    it('sanitizes folder against path traversal attempts', async () => {
      const stream = createMockStream('test-content');
      // Attacker attempts traversal '../../etc'
      const url = await service.upload(
        stream,
        'photo.png',
        'image/png',
        '../../etc',
      );

      // Traversal stripped; sanitized to 'etc'
      expect(url).toMatch(/^\/public\/etc\/[a-f0-9-]+\.png$/);
      expect(url).not.toContain('..');

      const filePath = path.join(process.cwd(), url.slice(1));
      createdLocalFiles.push(filePath);
    });

    it('rejects unsupported MIME types with BadRequestException', async () => {
      const stream = createMockStream('malicious-pdf');

      await expect(
        service.upload(stream, 'doc.pdf', 'application/pdf', 'products'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deletes local file on disk when delete() is called', async () => {
      const stream = createMockStream('delete-me');
      const url = await service.upload(
        stream,
        'photo.webp',
        'image/webp',
        'products',
      );

      const filePath = path.join(process.cwd(), url.slice(1));
      expect(fs.existsSync(filePath)).toBe(true);

      await service.delete(url);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('rejects path traversal in delete() URL', async () => {
      await expect(service.delete('/public/../../etc/passwd')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('Cloudflare R2 Storage Mode (Configured)', () => {
    beforeEach(async () => {
      mockUploadDone.mockReset().mockResolvedValue({});
      mockS3Send.mockReset().mockResolvedValue({});

      mockConfigService = {
        get: jest.fn((key: string, defaultVal: string) => {
          if (key === 'R2_ACCOUNT_ID') return 'mock-cf-account-123';
          if (key === 'R2_ACCESS_KEY_ID') return 'mock-access-key';
          if (key === 'R2_SECRET_ACCESS_KEY') return 'mock-secret-key';
          if (key === 'R2_BUCKET') return 'gramoz-media';
          if (key === 'R2_PUBLIC_URL') return 'https://media.gramoz.com';
          return defaultVal;
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StorageService,
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      service = module.get(StorageService);
    });

    it('uploads file stream to Cloudflare R2 bucket with public URL', async () => {
      const stream = createMockStream('r2-image-bytes');
      const url = await service.upload(
        stream,
        'dress.png',
        'image/png',
        'products',
      );

      expect(url).toMatch(
        /^https:\/\/media\.gramoz\.com\/products\/[a-f0-9-]+\.png$/,
      );
      expect(mockUploadDone).toHaveBeenCalledTimes(1);
    });

    it('deletes object from Cloudflare R2 bucket using extracted key', async () => {
      const fileUrl = 'https://media.gramoz.com/products/test-image-uuid.jpg';
      await service.delete(fileUrl);

      expect(mockS3Send).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'gramoz-media',
          Key: 'products/test-image-uuid.jpg',
        }),
      );
    });
  });
});
