import {describe, expect, it, vi} from "vitest";
import {NetworkCore} from "../../../../src/network/core/networkCore.js";

describe("network / core / NetworkCore", () => {
  it("quiesces peer management before disconnecting peers", async () => {
    const calls: string[] = [];
    const modules = {
      libp2p: {stop: vi.fn(async () => calls.push("libp2p.stop"))},
      gossip: {stop: vi.fn(async () => calls.push("gossip.stop"))},
      reqResp: {
        stop: vi.fn(async () => calls.push("reqResp.stop")),
        unregisterAllProtocols: vi.fn(async () => calls.push("reqResp.unregister")),
      },
      attnetsService: {close: vi.fn(() => calls.push("attnets.close"))},
      syncnetsService: {close: vi.fn(() => calls.push("syncnets.close"))},
      peerManager: {
        quiesce: vi.fn(async () => calls.push("peerManager.quiesce")),
        goodbyeAndDisconnectAllPeers: vi.fn(async () => calls.push("peerManager.goodbye")),
        close: vi.fn(async () => calls.push("peerManager.close")),
      },
      networkConfig: {},
      peersData: {},
      metadata: {},
      logger: {debug: vi.fn()},
      config: {},
      clock: {
        on: vi.fn(),
        off: vi.fn(() => calls.push("clock.off")),
      },
      statusCache: {},
      metrics: null,
      opts: {},
    } as unknown as ConstructorParameters<typeof NetworkCore>[0];

    const network = new NetworkCore(modules);
    await network.close();

    expect(calls).toEqual([
      "clock.off",
      "peerManager.quiesce",
      "peerManager.goodbye",
      "peerManager.close",
      "gossip.stop",
      "reqResp.stop",
      "reqResp.unregister",
      "attnets.close",
      "syncnets.close",
      "libp2p.stop",
    ]);
  });
});
