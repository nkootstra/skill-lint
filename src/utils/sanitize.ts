/**
 * Secret redaction utility.
 *
 * Automatically detects and redacts API keys, tokens, and other secrets
 * from text output.
 */

/** Env var name patterns that likely contain secrets */
const SECRET_PATTERNS = [
  /_KEY$/i,
  /_TOKEN$/i,
  /_SECRET$/i,
  /_PASSWORD$/i,
  /_CREDENTIALS$/i,
  /^API_KEY$/i,
  /^AUTH_TOKEN$/i,
];

/**
 * Collect secret values from environment variables whose names match
 * common secret patterns.
 */
export function collectSecrets(env: Record<string, string | undefined> = process.env): string[] {
  const secrets: string[] = [];

  for (const [key, value] of Object.entries(env)) {
    if (!value || value.length < 6) continue;
    if (SECRET_PATTERNS.some((pattern) => pattern.test(key))) {
      secrets.push(value);
    }
  }

  // Sort by length descending so longer secrets are replaced first
  // (prevents partial matches)
  return secrets.sort((a, b) => b.length - a.length);
}

/**
 * Redact all known secret values from a string.
 */
export function redactSecrets(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    // Use split/join for reliable replacement (no regex escaping needed)
    result = result.split(secret).join("[REDACTED]");
  }
  return result;
}

/**
 * Deep-redact secrets from a JSON-serializable value.
 * Returns a new object with all string values sanitized.
 */
export function redactSecretsDeep<T>(value: T, secrets: string[]): T {
  if (secrets.length === 0) return value;

  const json = JSON.stringify(value);
  const redacted = redactSecrets(json, secrets);
  return JSON.parse(redacted) as T;
}
