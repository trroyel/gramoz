/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { FastifyRequest } from 'fastify';
import { Readable } from 'stream';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILES = 5;
const MAX_FIELDS = 10;
const MAX_FIELD_SIZE = 100 * 1024; // 100KB
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
]);

function drainPartStream(part: any): void {
  if (part?.file && typeof part.file.resume === 'function') {
    part.file.resume();
  }
}

function validateImageSignatureAndContent(buffer: Buffer, mime: string): void {
  if (buffer.length < 12) {
    throw new BadRequestException(
      'Invalid image payload: file too small or corrupted',
    );
  }

  // Inspect leading 512 bytes for script, HTML, or SVG tags (Stored XSS mitigation)
  const headerText = buffer
    .subarray(0, Math.min(buffer.length, 512))
    .toString('latin1')
    .toLowerCase();

  if (
    headerText.includes('<html') ||
    headerText.includes('<!doctype') ||
    headerText.includes('<?xml') ||
    headerText.includes('<svg') ||
    headerText.includes('<script')
  ) {
    throw new BadRequestException(
      'Invalid file content: active markup or script tags detected in image stream',
    );
  }

  // JPEG magic bytes: FF D8 FF
  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      throw new BadRequestException(
        'Invalid file signature: content does not match JPEG format',
      );
    }
    return;
  }

  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  if (mime === 'image/png') {
    const isPng =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a;
    if (!isPng) {
      throw new BadRequestException(
        'Invalid file signature: content does not match PNG format',
      );
    }
    return;
  }

  // WebP magic bytes: RIFF at 0..3, WEBP at 8..11
  if (mime === 'image/webp') {
    const isRiff =
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46;
    const isWebp =
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50;
    if (!isRiff || !isWebp) {
      throw new BadRequestException(
        'Invalid file signature: content does not match WebP format',
      );
    }
    return;
  }

  throw new BadRequestException('Unsupported image MIME type');
}

@Injectable()
export class FastifyFileUploadInterceptor implements NestInterceptor {
  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();

    if (typeof req.isMultipart !== 'function' || !req.isMultipart()) {
      (req as any).parsedBody = req.body || {};
      return next.handle();
    }

    const parsedBody: Record<string, any> = {};
    const uploadedFiles: Array<{
      filename: string;
      mimetype: string;
      file: Readable;
    }> = [];

    try {
      const parts = req.parts({
        limits: {
          fileSize: MAX_FILE_SIZE,
          files: MAX_FILES,
          fields: MAX_FIELDS,
          fieldSize: MAX_FIELD_SIZE,
        },
      });

      for await (const part of parts) {
        if (part.type === 'file' && part.filename) {
          if (uploadedFiles.length >= MAX_FILES) {
            drainPartStream(part);
            throw new BadRequestException(
              `Maximum of ${MAX_FILES} files allowed`,
            );
          }

          const mime = (part.mimetype || '').toLowerCase();
          if (!ALLOWED_MIME_TYPES.has(mime)) {
            drainPartStream(part);
            throw new BadRequestException(
              'Only JPEG, PNG, and WebP image files are allowed',
            );
          }

          let buffer: Buffer;
          try {
            buffer = await part.toBuffer();
          } catch (err: any) {
            drainPartStream(part);
            if (
              err?.code === 'FST_REQ_FILE_TOO_LARGE' ||
              err?.message?.includes('limit')
            ) {
              throw new BadRequestException('File size exceeds the 5MB limit');
            }
            throw err;
          }

          if (
            (part as any).file?.truncated ||
            (part as any).truncated ||
            buffer.length > MAX_FILE_SIZE
          ) {
            throw new BadRequestException('File size exceeds the 5MB limit');
          }

          // Content and magic bytes validation against declared MIME
          validateImageSignatureAndContent(buffer, mime);

          uploadedFiles.push({
            filename: part.filename,
            mimetype: mime,
            file: Readable.from(buffer),
          });
        } else if (part.type === 'field') {
          parsedBody[part.fieldname] = part.value;
        }
      }

      // Attach parsed data to request object
      (req as any).parsedBody = parsedBody;
      (req as any).uploadedFile = uploadedFiles[0];
      (req as any).uploadedFiles = uploadedFiles;
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      throw new BadRequestException(
        err?.message || 'Failed to parse multipart request',
      );
    }

    return next.handle();
  }
}
