export enum ClientKind {
  Lighthouse = "Lighthouse",
  Nimbus = "Nimbus",
  Teku = "Teku",
  Prysm = "Prysm",
  Lodestar = "Lodestar",
  Unknown = "Unknown",
}

export function clientFromAgentVersion(agentVersion: string): ClientKind {
  const slashIndex = agentVersion.indexOf("/");
  const agent = slashIndex >= 0 ? agentVersion.slice(0, slashIndex) : agentVersion;
  const agentLC = agent.toLowerCase();
  if (agentLC === "lighthouse") return ClientKind.Lighthouse;
  if (agentLC === "teku") return ClientKind.Teku;
  if (agentLC === "prysm") return ClientKind.Prysm;
  if (agentLC === "nimbus") return ClientKind.Nimbus;
  if (agentLC === "lodestar" || agentLC === "js-libp2p") return ClientKind.Lodestar;
  return ClientKind.Unknown;
}
