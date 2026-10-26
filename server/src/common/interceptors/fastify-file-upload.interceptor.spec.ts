import {
  BadRequestException,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { FastifyFileUploadInterceptor } from './fastify-file-upload.interceptor';
import { of } from 'rxjs';

describe('FastifyFileUploadInterceptor (Security & Resource Safety — TASK-23 / TASK-23F)', () => {
  let interceptor: FastifyFileUploadInterceptor;
  let mockCallHandler: CallHandler;

  // Real valid file signatures
  const validJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01,
  ]);
  const validPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
  ]);
  const validWebp = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x20,
  ]);

  beforeEach(() => {
    interceptor = new FastifyFileUploadInterceptor();
    mockCallHandler = {
      handle: jest.fn().mockReturnValue(of('handled')),
    };
  });

  const createMockContext = (req: any): ExecutionContext => ({
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}) as any,
      getNext: () => ({}) as any,
    }),
    getClass: jest.fn(),
    getHandler: jest.fn(),
    getArgs: jest.fn(),
    getArgByIndex: jest.fn(),
    switchToRpc: jest.fn(),
    switchToWs: jest.fn(),
    getType: jest.fn(),
  });

  it('passes through non-multipart requests untouched', async () => {
    const req = {
      isMultipart: () => false,
      body: { name: 'Item' },
    };
    const context = createMockContext(req);

    const stream$ = await interceptor.intercept(context, mockCallHandler);
    expect(stream$).toBeDefined();
    expect((req as any).parsedBody).toEqual({ name: 'Item' });
    expect(mockCallHandler.handle).toHaveBeenCalled();
  });

  it('accepts valid JPEG, PNG, and WebP images under 5MB', async () => {
    const req = {
      isMultipart: () => true,
      parts: () =>
        (async function* () {
          yield {
            type: 'file',
            filename: 'photo.jpg',
            mimetype: 'image/jpeg',
            file: { resume: jest.fn() },
            toBuffer: async () => validJpeg,
          };
          yield {
            type: 'field',
            fieldname: 'title',
            value: 'My Review',
          };
        })(),
    };
    const context = createMockContext(req);

    await interceptor.intercept(context, mockCallHandler);
    expect((req as any).parsedBody).toEqual({ title: 'My Review' });
    expect((req as any).uploadedFile).toBeDefined();
    expect((req as any).uploadedFile.filename).toBe('photo.jpg');
    expect((req as any).uploadedFile.mimetype).toBe('image/jpeg');
    expect((req as any).uploadedFiles.length).toBe(1);
  });

  it('accepts valid PNG image with authentic signature', async () => {
    const req = {
      isMultipart: () => true,
      parts: () =>
        (async function* () {
          yield {
            type: 'file',
            filename: 'screenshot.png',
            mimetype: 'image/png',
            file: { resume: jest.fn() },
            toBuffer: async () => validPng,
          };
        })(),
    };
    const context = createMockContext(req);

    await interceptor.intercept(context, mockCallHandler);
    expect((req as any).uploadedFile.filename).toBe('screenshot.png');
    expect((req as any).uploadedFile.mimetype).toBe('image/png');
  });

  it('accepts valid WebP image with authentic RIFF/WEBP signature', async () => {
    const req = {
      isMultipart: () => true,
      parts: () =>
        (async function* () {
          yield {
            type: 'file',
            filename: 'graphic.webp',
            mimetype: 'image/webp',
            file: { resume: jest.fn() },
            toBuffer: async () => validWebp,
          };
        })(),
    };
    const context = createMockContext(req);

    await interceptor.intercept(context, mockCallHandler);
    expect((req as any).uploadedFile.filename).toBe('graphic.webp');
    expect((req as any).uploadedFile.mimetype).toBe('image/webp');
  });

  it('blocks dangerous SVG files (Stored XSS vector) with non-buffering stream draining', async () => {
    const mockResume = jest.fn();
    const req = {
      isMultipart: () => true,
      parts: () =>
        (async function* () {
          yield {
            type: 'file',
            filename: 'vector.svg',
            mimetype: 'image/svg+xml',
            file: { resume: mockResume },
            toBuffer: jest.fn(),
          };
        })(),
    };
    const context = createMockContext(req);

    await expect(
      interceptor.intercept(context, mockCallHandler),
    ).rejects.toThrow(BadRequestException);
    expect(mockResume).toHaveBeenCalled();
  });

  it('rejects HTML file disguised as JPEG (MIME spoofing defense)', async () => {
    const maliciousHtml = Buffer.from(
      '<!DOCTYPE html><html><head><script>alert("XSS")</script></head><body>evil</body></html>',
    );
    const req = {
      isMultipart: () => true,
      parts: () =>
        (async function* () {
          yield {
            type: 'file',
            filename: 'innocent.jpg',
            mimetype: 'image/jpeg',
            file: { resume: jest.fn() },
            toBuffer: async () => maliciousHtml,
          };
        })(),
    };
    const context = createMockContext(req);

    await expect(
      interceptor.intercept(context, mockCallHandler),
    ).rejects.toThrow(/Invalid file content|Invalid file signature/);
  });

  it('rejects SVG file disguised as PNG containing active scripts', async () => {
    const maliciousSvg = Buffer.from(
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const req = {
      isMultipart: () => true,
      parts: () =>
        (async function* () {
          yield {
            type: 'file',
            filename: 'avatar.png',
            mimetype: 'image/png',
            file: { resume: jest.fn() },
            toBuffer: async () => maliciousSvg,
          };
        })(),
    };
    const context = createMockContext(req);

    await expect(
      interceptor.intercept(context, mockCallHandler),
    ).rejects.toThrow(/Invalid file content|Invalid file signature/);
  });

  it('rejects file with invalid/corrupted magic bytes', async () => {
    const corruptedBytes = Buffer.from([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
    ]);
    const req = {
      isMultipart: () => true,
      parts: () =>
        (async function* () {
          yield {
            type: 'file',
            filename: 'corrupted.jpg',
            mimetype: 'image/jpeg',
            file: { resume: jest.fn() },
            toBuffer: async () => corruptedBytes,
          };
        })(),
    };
    const context = createMockContext(req);

    await expect(
      interceptor.intercept(context, mockCallHandler),
    ).rejects.toThrow(/Invalid file signature/);
  });

  it('accepts file exactly at 5MB boundary with valid signature', async () => {
    const boundaryBuffer = Buffer.alloc(5 * 1024 * 1024);
    validJpeg.copy(boundaryBuffer, 0, 0, validJpeg.length);

    const req = {
      isMultipart: () => true,
      parts: () =>
        (async function* () {
          yield {
            type: 'file',
            filename: 'max.jpg',
            mimetype: 'image/jpeg',
            file: { resume: jest.fn() },
            toBuffer: async () => boundaryBuffer,
          };
        })(),
    };
    const context = createMockContext(req);

    await interceptor.intercept(context, mockCallHandler);
    expect((req as any).uploadedFile).toBeDefined();
  });

  it('rejects files exceeding the 5MB size limit', async () => {
    const oversizedBuffer = Buffer.alloc(5 * 1024 * 1024 + 1); // 5MB + 1 byte
    validPng.copy(oversizedBuffer, 0, 0, validPng.length);

    const req = {
      isMultipart: () => true,
      parts: () =>
        (async function* () {
          yield {
            type: 'file',
            filename: 'huge.png',
            mimetype: 'image/png',
            file: { resume: jest.fn() },
            toBuffer: async () => oversizedBuffer,
          };
        })(),
    };
    const context = createMockContext(req);

    await expect(
      interceptor.intercept(context, mockCallHandler),
    ).rejects.toThrow(/File size exceeds the 5MB limit/);
  });

  it('rejects truncated file stream flagged by Fastify size limit parser', async () => {
    const truncatedPartBuffer = Buffer.alloc(1024);
    validJpeg.copy(truncatedPartBuffer, 0, 0, validJpeg.length);

    const req = {
      isMultipart: () => true,
      parts: () =>
        (async function* () {
          yield {
            type: 'file',
            filename: 'truncated.jpg',
            mimetype: 'image/jpeg',
            file: { resume: jest.fn(), truncated: true },
            toBuffer: async () => truncatedPartBuffer,
          };
        })(),
    };
    const context = createMockContext(req);

    await expect(
      interceptor.intercept(context, mockCallHandler),
    ).rejects.toThrow(/File size exceeds the 5MB limit/);
  });

  it('rejects multipart uploads with more than 5 files with non-buffering stream draining', async () => {
    const resumeMocks: any[] = [];
    const req = {
      isMultipart: () => true,
      parts: () =>
        (async function* () {
          for (let i = 1; i <= 6; i++) {
            const mockResume = jest.fn();
            resumeMocks.push(mockResume);
            yield {
              type: 'file',
              filename: `pic-${i}.png`,
              mimetype: 'image/png',
              file: { resume: mockResume },
              toBuffer: async () => validPng,
            };
          }
        })(),
    };
    const context = createMockContext(req);

    await expect(
      interceptor.intercept(context, mockCallHandler),
    ).rejects.toThrow(/Maximum of 5 files allowed/);
    // 6th file stream was safely drained without memory buffer
    expect(resumeMocks[5]).toHaveBeenCalled();
  });
});
