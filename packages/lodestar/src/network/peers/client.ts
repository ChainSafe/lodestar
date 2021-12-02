export enum ClientKind {
  Lighthouse = "Lighthouse",
  Nimbus = "Nimbus",
  Teku = "Teku",
  Prysm = "Prysm",
  Lodestar = "Lodestar",
  Unknown = "Unknown",
}

export type Client = {
  kind: ClientKind;
  version: string;
  osVersion: string;
};

export function clientFromAgentVersion(agentVersion: string): Client {
  const agentSplit = agentVersion.split("/");
  switch (agentSplit[0]) {
    // Lighthouse/v2.0.1-fff01b2/x86_64-linux
    case "Lighthouse":
      return {
        kind: ClientKind.Lighthouse,
        version: agentSplit[1] ?? "unknown",
        osVersion: agentSplit[2] ?? "unknown",
      };
    case "teku":
      // teku/teku/v21.11.0+62-g501ffa7/linux-x86_64/corretto-java-17
      return {
        kind: ClientKind.Teku,
        version: agentSplit[2] ?? "unknown",
        osVersion: agentSplit[3] ?? "unknown",
      };
    case "Prysm":
      // Prysm/v2.0.2/a80b1c252a9b4773493b41999769bf3134ac373f
      return {
        kind: ClientKind.Prysm,
        version: agentSplit[1] ?? "unknown",
        osVersion: "unknown",
      };
    case "nimbus":
      // nimbus
      return {
        kind: ClientKind.Nimbus,
        version: agentSplit[1] ?? "unknown",
        osVersion: agentSplit[2] ?? "unknown",
      };
    case "js-libp2p":
      // js-libp2p/0.32.4
      return {
        kind: ClientKind.Lodestar,
        version: agentSplit[1] ?? "unknown",
        osVersion: agentSplit[2] ?? "unknown",
      };
    default:
      return {
        kind: ClientKind.Unknown,
        version: "unknown",
        osVersion: "unknown",
      };
  }
}
