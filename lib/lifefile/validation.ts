import type { DocumentValidationResult } from './types.ts'

export const MAX_DOCUMENT_FILE_SIZE = 10 * 1024 * 1024 // 10 Megabytes

export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

const EXTENSION_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

/**
 * Checks magic byte signatures for PDF, JPEG, PNG, and WEBP.
 */
export function verifyMagicBytes(buffer: Buffer): { matches: boolean; detectedMime?: string } {
  if (buffer.length < 4) {
    return { matches: false }
  }

  // PDF signature: %PDF- (0x25, 0x50, 0x44, 0x46, 0x2D)
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return { matches: true, detectedMime: 'application/pdf' }
  }

  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { matches: true, detectedMime: 'image/png' }
  }

  // JPEG signature: FF D8 FF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { matches: true, detectedMime: 'image/jpeg' }
  }

  // WEBP signature: "RIFF" at 0..3 and "WEBP" at 8..11
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { matches: true, detectedMime: 'image/webp' }
  }

  return { matches: false }
}

/**
 * Validates an uploaded document file buffer, filename, and declared MIME type.
 */
export function validateDocumentUpload(
  buffer: Buffer,
  filename: string,
  declaredMimeType: string
): DocumentValidationResult {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Uploaded file is empty.' }
  }

  if (buffer.length > MAX_DOCUMENT_FILE_SIZE) {
    const sizeInMB = (buffer.length / (1024 * 1024)).toFixed(1)
    return {
      valid: false,
      error: `File size (${sizeInMB} MB) exceeds the maximum allowed limit of 10 MB.`,
    }
  }

  // Validate filename and extension
  const cleanName = filename.replace(/[/\\]/g, '').trim()
  if (!cleanName) {
    return { valid: false, error: 'Invalid or missing filename.' }
  }

  const dotIndex = cleanName.lastIndexOf('.')
  if (dotIndex === -1) {
    return {
      valid: false,
      error: 'File lacks an extension. Supported extensions: .pdf, .jpg, .jpeg, .png, .webp.',
    }
  }

  const extension = cleanName.substring(dotIndex).toLowerCase()
  const expectedMime = EXTENSION_TO_MIME[extension]

  if (!expectedMime) {
    return {
      valid: false,
      error: `Unsupported file extension (${extension}). Supported formats: PDF, JPG, PNG, WEBP.`,
    }
  }

  // Validate declared MIME type
  const normalizedDeclaredMime = declaredMimeType.toLowerCase().split(';')[0].trim()
  if (
    normalizedDeclaredMime &&
    !SUPPORTED_MIME_TYPES.includes(normalizedDeclaredMime as any) &&
    normalizedDeclaredMime !== 'application/octet-stream'
  ) {
    return {
      valid: false,
      error: `Unsupported MIME type (${normalizedDeclaredMime}). Supported formats: PDF, JPG, PNG, WEBP.`,
    }
  }

  // Verify file magic bytes signature
  const { matches, detectedMime } = verifyMagicBytes(buffer)
  if (!matches || !detectedMime) {
    return {
      valid: false,
      error: `File signature does not match authentic ${extension.toUpperCase().replace('.', '')} data. Please ensure the file is not corrupted or renamed.`,
    }
  }

  // Check that detected magic bytes agree with extension
  if (
    detectedMime !== expectedMime &&
    !(extension === '.jpeg' && detectedMime === 'image/jpeg') &&
    !(extension === '.jpg' && detectedMime === 'image/jpeg')
  ) {
    return {
      valid: false,
      error: `File contents (${detectedMime}) do not match file extension (${extension}).`,
    }
  }

  return {
    valid: true,
    normalizedMimeType: detectedMime,
    sanitizedFilename: cleanName,
  }
}
