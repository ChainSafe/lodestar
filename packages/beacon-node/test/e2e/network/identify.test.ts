import {generateKeyPair} from "@libp2p/crypto/keys";
import {afterEach, describe, expect, it} from "vitest";
import {Libp2p} from "../../../src/network/interface.js";
import {createNodeJsLibp2p} from "../../../src/network/libp2p/index.js";

describe("network / identify", () => {
  const nodes: Libp2p[] = [];

  afterEach(async () => {
    await Promise.all(nodes.splice(0).map((node) => node.stop()));
  });

  it.each([
    {
      name: "version and commit",
      opts: {version: "v1.50.1/developer-feature/80c248b"},
      expected: "lodestar",
    },
    {
      name: "version opt-in",
      opts: {version: "v1.50.1/developer-feature/80c248b", advertiseVersion: true},
      expected: "lodestar/v1.50.1/developer-feature/80c248b",
    },
    {
      name: "explicit public mode",
      opts: {version: "v1.50.1/80c248b", private: false},
      expected: "lodestar",
    },
    {
      name: "explicit version opt-out",
      opts: {version: "v1.50.1/80c248b", advertiseVersion: false},
      expected: "lodestar",
    },
    {
      name: "missing version",
      opts: {},
      expected: "lodestar",
    },
    {
      name: "version opt-in without a version",
      opts: {advertiseVersion: true},
      expected: "lodestar",
    },
    {
      name: "version opt-in with an empty version",
      opts: {version: "", advertiseVersion: true},
      expected: "lodestar",
    },
    {
      name: "private mode",
      opts: {version: "v1.50.1/80c248b", private: true, advertiseVersion: true},
      expected: "",
    },
    {
      name: "private mode without a version",
      opts: {private: true},
      expected: "",
    },
  ])("advertises only the allowed client identity with $name", async ({opts, expected}) => {
    const networkOpts = {
      localMultiaddrs: ["/ip4/127.0.0.1/tcp/0"],
      tcp: true,
      quic: false,
    };
    const server = await createNodeJsLibp2p(
      await generateKeyPair("secp256k1"),
      {...networkOpts, ...opts},
      {disablePeerDiscovery: true}
    );
    nodes.push(server);

    const client = await createNodeJsLibp2p(await generateKeyPair("secp256k1"), networkOpts, {
      disablePeerDiscovery: true,
    });
    nodes.push(client);

    const connection = await client.dial(server.getMultiaddrs());
    const result = await client.services.identify.identify(connection);

    expect(result.agentVersion).toBe(expected);
    expect(server.services.components.nodeInfo.version).toBe(opts.version ?? "unknown");
  });
});
