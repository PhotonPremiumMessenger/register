import * as path from 'path';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { config } from './config';
import { ApiError } from './auth';

export const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/zip': '.zip',
  'audio/mpeg': '.mp3',
  'video/mp4': '.mp4',
};

export const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploadsDir),
    filename: (_req, file, cb) => {
      const ext = ALLOWED_MIME[file.mimetype] || path.extname(file.originalname).slice(0, 10) || '.bin';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME[file.mimetype]) {
      cb(new ApiError(415, `File type "${file.mimetype}" is not allowed. Allowed: images, PDF, TXT, MD, ZIP, MP3, MP4.`));
      return;
    }
    cb(null, true);
  },
});

export function multerErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  const e = err as { code?: string; message?: string };
  if (e?.code === 'LIMIT_FILE_SIZE') {
    return `File is too large. Maximum size is ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`;
  }
  return e?.message || 'Upload failed.';
}
