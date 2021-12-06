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
  switch (agent.toLowerCase()) {
    case "lighthouse":
      return ClientKind.Lighthouse;
    case "teku":
      return ClientKind.Teku;
    case "prysm":
      return ClientKind.Prysm;
    case "nimbus":
      return ClientKind.Nimbus;
    case "js-libp2p":
      return ClientKind.Lodestar;
    default:
      return ClientKind.Unknown;
  }
}
