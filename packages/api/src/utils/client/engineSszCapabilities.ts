export type EngineSszEndpoint = `${"GET" | "POST"} /engine/${string}`;

const ENGINE_REST_PREFIX = "/engine/";

export function isEngineSszCapability(value: string): value is EngineSszEndpoint {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();
  return (
    (upper.startsWith("GET ") || upper.startsWith("POST ")) &&
    (lower.includes(`${ENGINE_REST_PREFIX}`) || lower.endsWith("/engine/v1/capabilities"))
  );
}

/**
 * Given CL-supported capabilities and EL-advertised capabilities from
 * engine_exchangeCapabilities, return the mutually-supported SSZ REST endpoints.
 */
export function getMutuallySupportedEngineSszCapabilities(
  clCapabilities: string[],
  elCapabilities: string[]
): Set<EngineSszEndpoint> {
  const clSet = new Set(clCapabilities.filter(isEngineSszCapability).map(normalizeCapability));
  const supported = new Set<EngineSszEndpoint>();

  for (const value of elCapabilities) {
    if (!isEngineSszCapability(value)) continue;
    const normalized = normalizeCapability(value);
    if (clSet.has(normalized)) {
      supported.add(normalized as EngineSszEndpoint);
    }
  }

  return supported;
}

export function isEngineSszEndpointSupported(
  supported: ReadonlySet<EngineSszEndpoint>,
  endpoint: EngineSszEndpoint
): boolean {
  return supported.has(normalizeCapability(endpoint) as EngineSszEndpoint);
}

function normalizeCapability(value: string): string {
  const [method, ...rest] = value.trim().split(/\s+/);
  const path = rest.join(" ").toLowerCase();
  return `${method.toUpperCase()} ${path}`;
}
