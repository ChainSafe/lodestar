import {generateKeyPair} from "@libp2p/crypto/keys";
import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {ssz} from "@lodestar/types";
import {ChainEventEmitter} from "../../../src/chain/emitter.js";
import {NetworkEventBus} from "../../../src/network/events.js";
import {Network} from "../../../src/network/network.js";

describe("network - publishSignedExecutionPayloadBid", () => {
  const config = createBeaconConfig(
    createChainForkConfig({
      ...configDef,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    }),
    Buffer.alloc(32, 0)
  );

  it("flood publishes own bids to the gossip network", async () => {
    const core = {publishGossip: vi.fn().mockResolvedValue(5)};
    // Minimal chain stub: the Network constructor only needs a clock and an event emitter it can
    // register listeners on; publishSignedExecutionPayloadBid touches neither beyond `clock.currentSlot`.
    const chain = {clock: {currentSlot: 0}, emitter: new ChainEventEmitter()};

    const network = new Network({
      privateKey: await generateKeyPair("secp256k1"),
      config,
      chain,
      logger: testLogger(),
      networkEventBus: new NetworkEventBus(),
      networkProcessor: {},
      core,
      aggregatorTracker: {},
    } as any);

    const signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    signedBid.message.slot = 1;

    const sentPeers = await network.publishSignedExecutionPayloadBid(signedBid);

    // floodPublish is the entire point of this feature: own bids must reach mesh peers immediately
    // rather than waiting on regular mesh propagation. Assert the flag actually reaches the core.
    expect(sentPeers).toBe(5);
    expect(core.publishGossip).toHaveBeenCalledTimes(1);
    expect(core.publishGossip).toHaveBeenCalledWith(
      expect.stringContaining("execution_payload_bid"),
      expect.any(Uint8Array),
      expect.objectContaining({floodPublish: true})
    );
  });
});
