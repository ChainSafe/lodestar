import {generateKeyPair} from "@libp2p/crypto/keys";
import {beforeEach, describe, expect, it, vi} from "vitest";

const {createLibp2pMock, quicMock} = vi.hoisted(() => ({
  createLibp2pMock: vi.fn(async () => ({}) as never),
  quicMock: vi.fn((options?: Record<string, unknown>) => ({options}) as never),
}));

vi.mock("libp2p", async (importActual) => {
  const mod = await importActual<typeof import("libp2p")>();
  return {
    ...mod,
    createLibp2p: createLibp2pMock,
  };
});

vi.mock("@chainsafe/libp2p-quic", async (importActual) => {
  const mod = await importActual<typeof import("@chainsafe/libp2p-quic")>();
  return {
    ...mod,
    quic: quicMock,
  };
});

import {createNodeJsLibp2p} from "../../../../src/network/libp2p/index.js";

describe("network / libp2p / createNodeJsLibp2p", () => {
  beforeEach(() => {
    createLibp2pMock.mockClear();
    quicMock.mockClear();
  });

  it.each([
    {
      case: "ipv4 only",
      localMultiaddrs: ["/ip4/0.0.0.0/udp/9001/quic-v1"],
      expected: {ipv4: true, ipv6: false},
    },
    {
      case: "ipv6 only",
      localMultiaddrs: ["/ip6/::/udp/9001/quic-v1"],
      expected: {ipv4: false, ipv6: true},
    },
    {
      case: "dual stack",
      localMultiaddrs: ["/ip4/0.0.0.0/udp/9001/quic-v1", "/ip6/::/udp/9001/quic-v1"],
      expected: {ipv4: true, ipv6: true},
    },
  ])("should pass the right QUIC socket family flags for $case", async ({localMultiaddrs, expected}) => {
    const privateKey = await generateKeyPair("secp256k1");

    await createNodeJsLibp2p(
      privateKey,
      {
        tcp: false,
        quic: true,
        localMultiaddrs,
      },
      {disablePeerDiscovery: true}
    );

    expect(quicMock).toHaveBeenCalledOnce();
    expect(quicMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ipv4: expected.ipv4,
        ipv6: expected.ipv6,
      })
    );
    expect(createLibp2pMock).toHaveBeenCalledOnce();
  });
});
