import { createHash, timingSafeEqual } from "crypto";

export function configuredApiKeys(
  pluralEnvName: string,
  singularEnvName: string,
): string[] {
  const configured = process.env[pluralEnvName] ?? process.env[singularEnvName];
  return configured
    ?.split(",")
    .map((key) => key.trim())
    .filter(Boolean) ?? [];
}

export function matchingApiKeyIndex(
  providedKey: string | undefined,
  expectedKeys: string[],
): number | undefined {
  if (providedKey === undefined) return undefined;

  const providedDigest = createHash("sha256").update(providedKey).digest();
  let matchedIndex: number | undefined;

  expectedKeys.forEach((expectedKey, index) => {
    const expectedDigest = createHash("sha256").update(expectedKey).digest();
    if (timingSafeEqual(providedDigest, expectedDigest) && matchedIndex === undefined) {
      matchedIndex = index;
    }
  });

  return matchedIndex;
}