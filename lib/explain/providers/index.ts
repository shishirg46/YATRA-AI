import type { ProviderErrorCode } from "./types";

const KNOWN_CODES = new Set<ProviderErrorCode>([
  "timeout", "429", "network", "json", "unexpected", "auth", "bad_request", "server_error",
]);

export function classifyError(err: unknown): ProviderErrorCode {
  const code = (err as any)?.code;
  if (KNOWN_CODES.has(code)) return code as ProviderErrorCode;
  return "unexpected";
}

export { groqProvider } from "./groq";
export type { CondensedNarrativeInput } from "./types";
export type { ProviderError } from "./types";
export type { ProviderErrorCode } from "./types";
