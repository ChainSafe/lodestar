import {describe, expect, it} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {NativeNetworkErrorCode} from "../../../../src/network/core/native/errors.js";
import {NetworkOptions, defaultNetworkOptions, validateNetworkOptions} from "../../../../src/network/options.js";

const options: NetworkOptions = {...defaultNetworkOptions, backend: "native", tcp: false};

describe("native option validation", () => {
  it.each([
    [{tcp: undefined}, "tcp=false"],
    [{tcp: true}, "tcp=false"],
    [{quic: false}, "quic=true"],
    [{mdns: true}, "mdns=false"],
    [{connectToDiscv5Bootnodes: true}, "connectToDiscv5Bootnodes=false"],
    [{gossipsubAwaitHandler: true}, "gossipsubAwaitHandler=false"],
    [{disablePeerScoring: true}, "disablePeerScoring=false"],
    [{rateLimitMultiplier: 2}, "rateLimitMultiplier=1"],
    [{protocolPrefix: "/other"}, 'protocolPrefix="/eth2/beacon_chain/req"'],
    [{gossipsubD: 9}, "gossipsubD=8"],
    [{gossipsubDLow: 7}, "gossipsubDLow=6"],
    [{gossipsubDHigh: 13}, "gossipsubDHigh=12"],
    [{discv5FirstQueryDelayMs: 0}, "omit discv5FirstQueryDelayMs"],
    [{dialTimeoutMs: 1000}, "omit dialTimeoutMs"],
    [{requestTimeoutMs: 1000}, "omit requestTimeoutMs"],
    [{respTimeoutMs: 1000}, "omit respTimeoutMs"],
    [{maxPeers: 257}, "maxPeers=257"],
    [{maxPeers: 1}, "maxPeers=1"],
    [{targetPeers: 0}, "targetPeers=0"],
    [{targetPeers: 210}, "targetPeers=210"],
    [{targetPeers: 1.5}, "targetPeers=1.5"],
    [{targetGroupPeers: 211}, "targetGroupPeers=211"],
    [{slotsToSubscribeBeforeAggregatorDuty: 2 * SLOTS_PER_EPOCH + 1}, "slotsToSubscribeBeforeAggregatorDuty"],
    [{directPeers: Array.from({length: 151}, () => "unused")}, "directPeers.length=151"],
    [{bootMultiaddrs: Array.from({length: 65}, () => "unused")}, "bootMultiaddrs.length=65"],
  ] satisfies [Partial<NetworkOptions>, string][])("identifies rejected options %j", (overrides, message) => {
    expect(() => validateNetworkOptions({...options, ...overrides})).toThrow(
      expect.objectContaining({
        type: {code: NativeNetworkErrorCode.CONFIGURATION, resource: expect.stringContaining(message)},
        message: expect.stringContaining(message),
      })
    );
    expect(() => validateNetworkOptions({...options, ...overrides, backend: "libp2p"})).not.toThrow();
  });

  it.each([undefined, false, true])("accepts defaults independently of useWorker=%s", (useWorker) => {
    expect(() => validateNetworkOptions({...options, useWorker})).not.toThrow();
    expect(() =>
      validateNetworkOptions({
        ...options,
        useWorker,
        mdns: false,
        connectToDiscv5Bootnodes: false,
        gossipsubAwaitHandler: false,
        disablePeerScoring: false,
        protocolPrefix: "/eth2/beacon_chain/req",
        gossipsubD: 8,
        gossipsubDLow: 6,
        gossipsubDHigh: 12,
      })
    ).not.toThrow();
  });

  it("accepts peer and subscription boundaries without mutating options", () => {
    const input = Object.freeze({
      ...options,
      maxPeers: 256,
      targetPeers: 255,
      targetGroupPeers: 256,
      slotsToSubscribeBeforeAggregatorDuty: 2 * SLOTS_PER_EPOCH,
      directPeers: Array.from({length: 192}, () => "unused"),
      bootMultiaddrs: Array.from({length: 64}, () => "unused"),
    });
    expect(() => validateNetworkOptions(input)).not.toThrow();
    expect(() =>
      validateNetworkOptions({
        ...options,
        maxPeers: 2,
        targetPeers: 1,
        targetGroupPeers: 1,
        slotsToSubscribeBeforeAggregatorDuty: 0,
      })
    ).not.toThrow();
  });
});
