import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { FastifyRequest } from 'fastify';

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
    let uploadedFile: { filename: string; mimetype: string; file: any } | undefined;

    try {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === 'file' && part.filename) {
          if (!part.mimetype.startsWith('image/')) {
            throw new BadRequestException('Only image files are allowed');
          }
          // Fastify Multipart parses streams. The storage service will consume `part.file`
          uploadedFile = {
            filename: part.filename,
            mimetype: part.mimetype,
            file: part.file,
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
