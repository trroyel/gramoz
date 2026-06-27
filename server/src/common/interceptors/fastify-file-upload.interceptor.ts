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

@Injectable()
export class FastifyFileUploadInterceptor implements NestInterceptor {
  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();

    if (!req.isMultipart()) {
      throw new BadRequestException('Request must be multipart/form-data');
    }

    const parsedBody: Record<string, any> = {};
    let uploadedFile: { filename: string; mimetype: string; file: Readable } | undefined;

    try {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === 'file' && part.filename) {
          if (!part.mimetype.startsWith('image/')) {
            // Drain the stream to avoid leaving the multipart body in a broken state
            await part.toBuffer().catch(() => {});
            throw new BadRequestException('Only image files are allowed');
          }

          // IMPORTANT: part.file is a live stream tied to the multipart iterator.
          // When the iterator advances to the next part (or finishes), the stream
          // is closed by @fastify/multipart — reading it later in the controller
          // will always fail (ECONNRESET / empty read).
          //
          // Solution: buffer the bytes NOW while the stream is still open,
          // then wrap in a fresh Readable so StorageService.upload() gets a
          // normal, re-readable stream.
          const buffer = await part.toBuffer();
          uploadedFile = {
            filename: part.filename,
            mimetype: part.mimetype,
            file: Readable.from(buffer),
          };
        } else if (part.type === 'field') {
          parsedBody[part.fieldname] = part.value;
        }
      }

      // Attach parsed data to the request object so the controller can access it
      (req as any).parsedBody = parsedBody;
      (req as any).uploadedFile = uploadedFile;
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      throw new BadRequestException('Failed to parse multipart request');
    }

    return next.handle();
  }
}
