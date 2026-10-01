/** What may be uploaded: receipt and DO photos, supplier letters and quotes. */

export const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
};

export interface UploadCandidate {
  fileName: string;
  mimeType: string;
  size: number;
}

/** Returns a user-facing problem, or null when the file is acceptable. */
export function checkUpload(file: UploadCandidate, maxBytes: number): string | null {
  if (file.size <= 0) return 'The file is empty.';
  if (file.size > maxBytes) {
    return `The file is too large. The limit is ${formatMb(maxBytes)}.`;
  }
  if (!ALLOWED_TYPES[file.mimeType]) {
    return 'Only photos (JPG, PNG, WEBP, HEIC) and PDF files can be attached.';
  }
  if (!file.fileName.trim()) return 'The file has no name.';
  return null;
}

/** Extension used on disk; taken from the checked MIME type, never from the user's file name. */
export function storageExtension(mimeType: string): string {
  return ALLOWED_TYPES[mimeType] ?? '';
}

/** Keeps the name for download headers but strips path parts and control characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f"]/g, '').trim();
  return (cleaned || 'file').slice(0, 255);
}

function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}
