/**
 * Extracts and parses a JSON object from an LLM response string.
 *
 * LLMs frequently wrap JSON in markdown code fences, add preamble text,
 * or include trailing commentary. This function handles those cases by:
 * 1. Stripping markdown code fences (```json ... ``` or ``` ... ```)
 * 2. Extracting the first top-level {...} block from surrounding text
 * 3. Falling back to raw JSON.parse if no pattern matches
 */
export function extractJSON<T>(raw: string): T {
  const trimmed = raw.trim();

  // 1. Strip markdown code fences
  const fencePattern = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/;
  const fenceMatch = fencePattern.exec(trimmed);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim()) as T;
  }

  // 2. Extract first balanced {...} block
  const braceStart = trimmed.indexOf("{");
  if (braceStart !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = braceStart; i < trimmed.length; i++) {
      const ch = trimmed[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (ch === "\\") {
        if (inString) {
          escape = true;
        }
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          return JSON.parse(trimmed.slice(braceStart, i + 1)) as T;
        }
      }
    }
  }

  // 3. Last resort: try parsing the entire string as-is
  return JSON.parse(trimmed) as T;
}
