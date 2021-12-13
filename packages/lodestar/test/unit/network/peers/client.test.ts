import {expect} from "chai";
import {clientFromAgentVersion, ClientKind} from "../../../../src/network/peers/client";

describe("clientFromAgentVersion", () => {
  const testCases: {name: string; agentVersion: string; client: ClientKind}[] = [
    {
      name: "lighthouse",
      agentVersion: "Lighthouse/v2.0.1-fff01b2/x86_64-linux",
      client: ClientKind.Lighthouse,
    },
    {
      name: "teku",
      agentVersion: "teku/teku/v21.11.0+62-g501ffa7/linux-x86_64/corretto-java-17",
      client: ClientKind.Teku,
    },
    {
      name: "nimbus",
      agentVersion: "nimbus",
      client: ClientKind.Nimbus,
    },
    {
      name: "prysm",
      agentVersion: "Prysm/v2.0.2/a80b1c252a9b4773493b41999769bf3134ac373f",
      client: ClientKind.Prysm,
    },
    {
      name: "lodestar",
      agentVersion: "js-libp2p/0.32.4",
      client: ClientKind.Lodestar,
    },
  ];

  for (const {name, agentVersion, client} of testCases) {
    it(name, () => {
      expect(clientFromAgentVersion(agentVersion)).to.be.equal(client, `cannot parse ${name} agent version`);
    });
  }
});
