import {describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {BeaconChain} from "../../../src/chain/chain.js";
import {Metrics} from "../../../src/metrics/index.js";

describe("BeaconChain pubkey cache metrics", () => {
  it("reports the current pubkey cache size and capacity on scrape", () => {
    const size = {set: vi.fn()};
    const capacity = {set: vi.fn()};
    const set = vi.fn();
    const metrics = {
      bls: {pubkeyCacheSize: size, pubkeyCacheCapacity: capacity},
      opPool: {
        attestationPool: {size: {set}},
        attesterSlashingPoolSize: {set},
        deferredVoluntaryExitPool: {size: {set}},
        proposerSlashingPoolSize: {set},
        voluntaryExitPoolSize: {set},
        syncCommitteeMessagePoolSize: {set},
        payloadAttestationPool: {size: {set}},
        executionPayloadBidPool: {size: {set}},
        blsToExecutionChangePoolSize: {set},
      },
      chain: {blacklistedBlocks: {set}},
    } as unknown as Metrics;
    const chain = {
      attestationPool: {getAttestationCount: () => 0},
      opPool: {
        attesterSlashingsSize: 0,
        proposerSlashingsSize: 0,
        voluntaryExitsSize: 0,
        blsToExecutionChangeSize: 0,
      },
      syncCommitteeMessagePool: {size: 0},
      payloadAttestationPool: {size: 0},
      executionPayloadBidPool: {size: 0},
      deferredVoluntaryExitPool: {size: () => 0},
      blacklistedBlocks: new Map(),
      pubkeyCache: {size: 123, capacity: 456},
      getHeadState: () => ({forkName: ForkName.phase0}),
    } as unknown as BeaconChain;

    BeaconChain.prototype["onScrapeMetrics"].call(chain, metrics);

    expect(size.set).toHaveBeenCalledWith(123);
    expect(capacity.set).toHaveBeenCalledWith(456);
  });
});
