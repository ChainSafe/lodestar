import {expect} from "chai";
import {Client, clientFromAgentVersion, ClientKind} from "../../../../src/network/peers/client";

describe("clientFromAgentVersion", () => {
  const testCases: {name: string; agentVersion: string; client: Client}[] = [
    {
      name: "lighthouse",
      agentVersion: "Lighthouse/v2.0.1-fff01b2/x86_64-linux",
      client: {
        kind: ClientKind.Lighthouse,
        version: "v2.0.1-fff01b2",
        osVersion: "x86_64-linux",
      },
    },
    {
      name: "teku",
      agentVersion: "teku/teku/v21.11.0+62-g501ffa7/linux-x86_64/corretto-java-17",
      client: {
        kind: ClientKind.Teku,
        version: "v21.11.0+62-g501ffa7",
        osVersion: "linux-x86_64",
      },
    },
    {
      name: "nimbus",
      agentVersion: "nimbus",
      client: {
        kind: ClientKind.Nimbus,
        version: "unknown",
        osVersion: "unknown",
      },
    },
    {
      name: "prysm",
      agentVersion: "Prysm/v2.0.2/a80b1c252a9b4773493b41999769bf3134ac373f",
      client: {
        kind: ClientKind.Prysm,
        version: "v2.0.2",
        osVersion: "unknown",
      },
    },
    {
      name: "lodestar",
      agentVersion: "js-libp2p/0.32.4",
      client: {
        kind: ClientKind.Lodestar,
        version: "0.32.4",
        osVersion: "unknown",
      },
    },
  ];

  for (const {name, agentVersion, client} of testCases) {
    it(name, () => {
      expect(clientFromAgentVersion(agentVersion)).to.be.deep.equal(client, `cannot parse ${name} agent version`);
    });
  }
});
