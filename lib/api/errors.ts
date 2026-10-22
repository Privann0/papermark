export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unprocessable_entity"
  | "rate_limit_exceeded"
  | "internal_server_error";

const ERROR_STATUS_CODES: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable_entity: 422,
  rate_limit_exceeded: 429,
  internal_server_error: 500,
};

export class PapermarkApiError extends Error {
  readonly name = "PapermarkApiError";
  readonly statusCode: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.statusCode = ERROR_STATUS_CODES[code];
  }
}
