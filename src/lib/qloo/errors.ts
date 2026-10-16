export type QlooErrorKind =
  | "invalid_request" // rejected locally before any network call
  | "auth" // 401/403
  | "rate_limit" // 429
  | "not_found" // 404 / no matching path
  | "bad_request" // other 4xx (e.g. 400 no locality match)
  | "server" // 5xx
  | "timeout"
  | "network"
  | "invalid_response"; // 2xx but not the shape we require

/**
 * Error raised by the Qloo client. Messages are written by us, never copied
 * from request headers, so they cannot contain the API key.
 */
export class QlooError extends Error {
  readonly kind: QlooErrorKind;
  readonly status?: number;
  /** Seconds, only for rate_limit when Qloo sent Retry-After. */
  readonly retryAfterSeconds?: number;

  constructor(
    kind: QlooErrorKind,
    message: string,
    opts: { status?: number; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = "QlooError";
    this.kind = kind;
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.retryAfterSeconds !== undefined) this.retryAfterSeconds = opts.retryAfterSeconds;
  }

  /** User-facing recovery hint for the app's error states. */
  get retryable(): boolean {
    return this.kind === "server" || this.kind === "timeout" || this.kind === "network";
  }
}
