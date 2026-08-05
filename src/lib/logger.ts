// Structured operational/security logging (Global Engineering Requirements
// §16). A dedicated Owner system-status page and external log aggregator are
// explicitly not required in V1 — "Backend logs are sufficient" — so this
// writes one structured JSON line per event via console.error, ready for
// whatever log collector the deployment PaaS attaches without extra plumbing.

export type LogCategory =
  | "AUTH_FAILURE"
  | "UNAUTHORIZED_ACCESS"
  | "RATE_LIMIT_EXCEEDED"
  | "PRACTICE_SET_GENERATION_FAILURE"
  | "PREDICTION_GENERATION_FAILURE"
  | "PAYMENT_WEBHOOK_FAILURE"
  | "SCHOOL_VERIFICATION_FAILURE"
  | "MEDIA_PROCESSING_FAILURE"
  | "EMAIL_DELIVERY_FAILURE"
  | "SERVER_ERROR"
  | "DATABASE_CONNECTIVITY_FAILURE";

export type LogContext = {
  // Internal account id — GER §5 prefers this over email for general logs.
  accountId?: string;
  // Only for restricted support/security logs where identifying the
  // affected account is necessary (GER §5) — never pair with unrelated
  // student academic data in the same entry.
  email?: string;
  organizationId?: string;
  affectedResourceId?: string;
  requestId?: string;
  [key: string]: unknown;
};

// Defense-in-depth backstop: GER §5 says logs must never contain passwords,
// tokens, session cookies, card data, or provider secrets. Call sites should
// never pass these in the first place, but a key-name match here drops the
// value before it can reach stdout regardless.
const SENSITIVE_KEY_PATTERN = /password|token|secret|cookie|cardnumber|cvc|authorization/i;

function redact(context: LogContext): LogContext {
  const safe: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    safe[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : value;
  }
  return safe;
}

export function logEvent(category: LogCategory, message: string, context: LogContext = {}): void {
  const entry = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? "development",
    category,
    message,
    ...redact(context),
  };
  console.error(JSON.stringify(entry));
}

export function logAuthFailure(message: string, context?: LogContext): void {
  logEvent("AUTH_FAILURE", message, context);
}

export function logUnauthorizedAccess(message: string, context?: LogContext): void {
  logEvent("UNAUTHORIZED_ACCESS", message, context);
}

export function logRateLimitExceeded(message: string, context?: LogContext): void {
  logEvent("RATE_LIMIT_EXCEEDED", message, context);
}

export function logGenerationFailure(message: string, context?: LogContext): void {
  logEvent("PRACTICE_SET_GENERATION_FAILURE", message, context);
}

export function logPredictionFailure(message: string, context?: LogContext): void {
  logEvent("PREDICTION_GENERATION_FAILURE", message, context);
}

export function logPaymentFailure(message: string, context?: LogContext): void {
  logEvent("PAYMENT_WEBHOOK_FAILURE", message, context);
}

export function logSchoolVerificationFailure(message: string, context?: LogContext): void {
  logEvent("SCHOOL_VERIFICATION_FAILURE", message, context);
}

export function logMediaFailure(message: string, context?: LogContext): void {
  logEvent("MEDIA_PROCESSING_FAILURE", message, context);
}

export function logEmailDeliveryFailure(message: string, context?: LogContext): void {
  logEvent("EMAIL_DELIVERY_FAILURE", message, context);
}

export function logServerError(message: string, context?: LogContext): void {
  logEvent("SERVER_ERROR", message, context);
}

export function logDatabaseConnectivityFailure(message: string, context?: LogContext): void {
  logEvent("DATABASE_CONNECTIVITY_FAILURE", message, context);
}
