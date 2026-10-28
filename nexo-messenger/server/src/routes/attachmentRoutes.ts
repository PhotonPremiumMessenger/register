import * as fs from 'fs';
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { ApiError, asyncHandler, requireAuth } from '../auth';
import { get, run, nowIso } from '../db';
import { config } from '../config';
import { upload, multerErrorMessage, ALLOWED_MIME } from '../uploads';
import { attachmentDto } from '../dto';

export const attachmentRouter = Router();

interface AttachmentRow {
  id: string;
  uploader_id: string;
  kind: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
}

/** Authorization check — the RLS-equivalent for stored files. */
function canAccess(userId: string, att: AttachmentRow): boolean {
  if (att.uploader_id === userId) return true;
  if (att.kind !== 'message') return true; // avatars are visible to signed-in users

  const msg = get<{ conversation_id: string | null; group_id: string | null }>(
    'SELECT conversation_id, group_id FROM messages WHERE attachment_id = ?',
    att.id
  );
  if (msg) {
    if (msg.conversation_id) {
      return Boolean(
        get(
          'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
          msg.conversation_id,
          userId
        )
      );
    }
    if (msg.group_id) {
      return Boolean(
        get(
          'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
          msg.group_id,
          userId
        )
      );
    }
  }
  const post = get<{ channel_id: string }>(
    'SELECT channel_id FROM channel_posts WHERE attachment_id = ?',
    att.id
  );
  if (post) {
    return Boolean(
      get(
        'SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?',
        post.channel_id,
        userId
      )
    );
  }
  return false; // orphaned message attachment: owner only
}

attachmentRouter.post(
  '/',
  requireAuth,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'No file was provided.');
    const kind = String(req.body?.kind || 'message');
    if (!['avatar', 'group_avatar', 'channel_avatar', 'message'].includes(kind)) {
      fs.promises.unlink(req.file.path).catch(() => undefined);
      throw new ApiError(400, 'Invalid attachment kind.');
    }
    if (!ALLOWED_MIME[req.file.mimetype]) {
      fs.promises.unlink(req.file.path).catch(() => undefined);
      throw new ApiError(415, 'File type not allowed.');
    }
    const id = randomUUID();
    run(
      `INSERT INTO attachments (id, uploader_id, kind, file_name, mime_type, size_bytes, storage_path, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      id,
      req.userId!,
      kind,
      req.file.originalname.slice(0, 200),
      req.file.mimetype,
      req.file.size,
      path_relative(req.file.path),
      nowIso()
    );
    res.status(201).json({ attachment: attachmentDto(id) });
  })
);

function path_relative(absolute: string): string {
  // Store relative to the uploads dir so DATA_DIR can move.
  return absolute.startsWith(config.uploadsDir)
    ? absolute.slice(config.uploadsDir.length).replace(/^[\\/]+/, '')
    : absolute;
}

attachmentRouter.get(
  '/:id/file',
  requireAuth,
  asyncHandler(async (req, res) => {
    const att = get<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', req.params.id);
    if (!att) throw new ApiError(404, 'Attachment not found.');
    if (!canAccess(req.userId!, att)) {
      throw new ApiError(403, 'You do not have permission to access this file.');
    }
    const absolute = att.storage_path.startsWith('/')
      ? att.storage_path
      : `${config.uploadsDir}/${att.storage_path}`;
    if (!fs.existsSync(absolute)) throw new ApiError(410, 'Stored file is missing.');

    res.setHeader('Content-Type', att.mime_type);
    res.setHeader('Content-Length', String(att.size_bytes));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const inline = att.mime_type.startsWith('image/') || att.mime_type === 'application/pdf';
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${att.file_name.replace(/"/g, '')}"`
    );
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(absolute).pipe(res);
  })
);

attachmentRouter.head(
  '/:id/file',
  requireAuth,
  asyncHandler(async (req, res) => {
    const att = get<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', req.params.id);
    if (!att) throw new ApiError(404, 'Attachment not found.');
    if (!canAccess(req.userId!, att)) throw new ApiError(403, 'Forbidden.');
    res.setHeader('Content-Type', att.mime_type);
    res.end();
  })
);

// Error translation for multer failures happens in the global error handler;
// export for index.ts
export { multerErrorMessage };
