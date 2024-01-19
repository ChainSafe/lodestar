export enum ClientKind {
  Lighthouse = "Lighthouse",
  Nimbus = "Nimbus",
  Teku = "Teku",
  Prysm = "Prysm",
  Lodestar = "Lodestar",
  Unknown = "Unknown",
}

/**
 * Get known client from agent version.
 * If client is not known, don't return ClientKind.Unknown here.
 * For metrics it'll have fallback logic to use ClientKind.Unknown
 * For logs, we want to print out agentVersion instead for debugging purposes.
 */
export function getKnownClientFromAgentVersion(agentVersion: string): ClientKind | null {
  const slashIndex = agentVersion.indexOf("/");
  const agent = slashIndex >= 0 ? agentVersion.slice(0, slashIndex) : agentVersion;
  const agentLC = agent.toLowerCase();
  if (agentLC === "lighthouse") return ClientKind.Lighthouse;
  if (agentLC === "teku") return ClientKind.Teku;
  if (agentLC === "prysm") return ClientKind.Prysm;
  if (agentLC === "nimbus") return ClientKind.Nimbus;
  if (agentLC === "lodestar" || agentLC === "js-libp2p") return ClientKind.Lodestar;

  return null;
}
