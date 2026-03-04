# Security Checklist

When reviewing code for security issues, check for:

## Injection Attacks
- SQL injection: Look for string concatenation in queries
- Command injection: Check for unsanitized input in shell commands
- XSS: Verify output encoding in web templates

## Authentication & Authorization
- Hardcoded credentials or API keys
- Missing authentication checks on endpoints
- Improper session management

## Data Handling
- Sensitive data logged or exposed in error messages
- Missing input validation at system boundaries
- Insecure deserialization
