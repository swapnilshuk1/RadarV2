/** Same measurement validity as quota settlement. Malformed telemetry is unknown,
 * never negative spend or refundable quota capacity. SQLite-only read predicate. */
export const measuredUsageSql = `(
  typeof(input_tokens)='integer' AND input_tokens BETWEEN 0 AND 9007199254740991
  AND typeof(output_tokens)='integer' AND output_tokens BETWEEN 0 AND 9007199254740991
  AND (reasoning_tokens IS NULL OR (typeof(reasoning_tokens)='integer' AND reasoning_tokens BETWEEN 0 AND 9007199254740991))
  AND (total_tokens IS NULL OR (typeof(total_tokens)='integer' AND total_tokens BETWEEN 0 AND 9007199254740991
    AND total_tokens>=input_tokens+output_tokens+CASE WHEN provider='vertex-gemini' THEN COALESCE(reasoning_tokens,0) ELSE 0 END))
)`;
