export type EngineSszEndpoint = `${"GET" | "POST"} /engine/${string}`;

export function isEngineSszCapability(value: string): value is EngineSszEndpoint {
  if (typeof value !== "string") return false;

  const parts = value.trim().split(/\s+/);
  if (parts.length < 2) return false;

  const method = parts[0].toUpperCase();
  if (method !== "GET" && method !== "POST") return false;

  const path = parts.slice(1).join(" ").toLowerCase();
  return path.startsWith("/engine/");
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
