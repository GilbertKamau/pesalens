export type ErrorCode =
  | 'VALIDATION_ERROR' | 'FILE_FORMAT_ERROR' | 'FILE_SIZE_ERROR' | 'IMPORT_ERROR' | 'DATABASE_ERROR'
  | 'AI_INITIALIZATION_ERROR' | 'AI_INFERENCE_ERROR' | 'AI_TIMEOUT' | 'AI_INVALID_RESPONSE' | 'AI_BUSY'
  | 'NOT_FOUND' | 'FORBIDDEN' | 'INTERNAL_SERVER_ERROR';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400, FILE_FORMAT_ERROR: 400, FILE_SIZE_ERROR: 413, IMPORT_ERROR: 409, DATABASE_ERROR: 500,
  AI_INITIALIZATION_ERROR: 503, AI_INFERENCE_ERROR: 502, AI_TIMEOUT: 504, AI_INVALID_RESPONSE: 502, AI_BUSY: 429,
  NOT_FOUND: 404, FORBIDDEN: 403, INTERNAL_SERVER_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
  }
}
