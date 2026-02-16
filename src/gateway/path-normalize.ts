const DEFAULT_MAX_DECODE_PASSES = 8;

/**
 * Normalizes request paths before boundary checks so encoded separator
 * variants cannot bypass local-admin or endpoint matching policies.
 */
export function normalizeGatewayBoundaryPath(
  pathname: string,
  maxDecodePasses = DEFAULT_MAX_DECODE_PASSES,
): string {
  let normalizedPath = pathname;

  for (let i = 0; i < maxDecodePasses; i += 1) {
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(normalizedPath);
    } catch {
      break;
    }
    if (decodedPath === normalizedPath) {
      break;
    }
    normalizedPath = decodedPath;
  }

  // Best-effort fallback when decode stops on malformed trailing sequences.
  normalizedPath = normalizedPath.replace(/%2f/gi, "/").replace(/%5c/gi, "/");
  normalizedPath = normalizedPath.replace(/\\/g, "/");
  normalizedPath = normalizedPath.replace(/\/{2,}/g, "/");

  if (normalizedPath.length > 1) {
    normalizedPath = normalizedPath.replace(/\/+$/, "");
  }
  return normalizedPath;
}
