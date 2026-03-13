import {describe, expect, it} from "vitest";
import {ArchiveMode, IBeaconNodeOptions} from "@lodestar/beacon-node";
import {RecursivePartial} from "@lodestar/utils";
import {BeaconNodeArgs, parseBeaconNodeArgs} from "../../../src/options/beaconNodeOptions/index.js";
import {NetworkArgs, parseArgs as parseNetworkArgs} from "../../../src/options/beaconNodeOptions/network.js";

describe("options / beaconNodeOptions", () => {
  it("Should parse BeaconNodeArgs", () => {
    // Cast to match the expected fully defined type
    const beaconNodeArgsPartial = {
      "api.maxGindicesInProof": 1000,
      "rest.namespace": [],
      "rest.cors": "*",
      rest: true,
      "rest.address": "127.0.0.1",
      "rest.port": 7654,
      "rest.headerLimit": 16384,
      "rest.bodyLimit": 30e6,
      "rest.stacktraces": true,

      "chain.blsVerifyAllMultiThread": true,
      "chain.blsVerifyAllMainThread": true,
      "chain.disableBlsBatchVerify": true,
      "chain.persistProducedBlocks": true,
      "chain.persistInvalidSszObjects": true,
      "chain.proposerBoost": false,
      "chain.proposerBoostReorg": false,
      "chain.disableImportExecutionFcU": false,
      "chain.preaggregateSlotDistance": 1,
      "chain.attDataCacheSlotDistance": 2,
      "chain.computeUnrealized": true,
      suggestedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "chain.assertCorrectProgressiveBalances": true,
      "chain.maxSkipSlots": 100,
      "chain.archiveStateEpochFrequency": 1024,
      "chain.minSameMessageSignatureSetsToBatch": 32,
      "chain.maxShufflingCacheEpochs": 100,
      "chain.archiveDataEpochs": 10000,
      "chain.nHistoricalStatesFileDataStore": true,
      "chain.maxBlockStates": 100,
      "chain.maxCPStateEpochsInMemory": 100,
      "chain.maxCPStateEpochsOnDisk": 1000,
      "chain.archiveMode": ArchiveMode.Frequency,
      emitPayloadAttributes: false,

      "execution.urls": ["http://localhost:8551"],
      "execution.timeout": 12000,
      "execution.retryDelay": 2000,
      "execution.retries": 1,

      builder: false,
      "builder.url": "http://localhost:8661",
      "builder.timeout": 12000,
      "builder.faultInspectionWindow": 32,
      "builder.allowedFaults": 8,

      metrics: true,
      "metrics.port": 8765,
      "metrics.address": "0.0.0.0",

      "monitoring.endpoint": "https://beaconcha.in/api/v1/client/metrics?apikey=secretKey&machine=machine1",
      "monitoring.interval": 60000,
      "monitoring.initialDelay": 30000,
      "monitoring.requestTimeout": 10000,
      "monitoring.collectSystemStats": true,

      discv5: true,
      listenAddress: "127.0.0.1",
      port: 9001,
      discoveryPort: 9002,
      quicPort: 9003,
      bootnodes: [
        "enr:-KG4QOtcP9X1FbIMOe17QNMKqDxCpm14jcX5tiOE4_TyMrFqbmhPZHK_ZPG2Gxb1GE2xdtodOfx9-cgvNtxnRyHEmC0ghGV0aDKQ9aX9QgAAAAD__________4JpZIJ2NIJpcIQDE8KdiXNlY3AyNTZrMaEDhpehBDbZjM_L9ek699Y7vhUJ-eAdMyQW_Fil522Y0fODdGNwgiMog3VkcIIjKA",
      ],
      targetPeers: 25,
      subscribeAllSubnets: true,
      slotsToSubscribeBeforeAggregatorDuty: 1,
      disablePeerScoring: true,
      mdns: false,
      "network.maxPeers": 30,
      "network.connectToDiscv5Bootnodes": true,
      "network.discv5FirstQueryDelayMs": 1000,
      "network.requestCountPeerLimit": 5,
      "network.blockCountTotalLimit": 1000,
      "network.blockCountPeerLimit": 500,
      "network.rateTrackerTimeoutMs": 60000,
      "network.dontSendGossipAttestationsToForkchoice": true,
      "network.allowPublishToZeroPeers": true,
      "network.gossipsubD": 4,
      "network.gossipsubDLow": 2,
      "network.gossipsubDHigh": 6,
      "network.gossipsubAwaitHandler": true,
      "network.rateLimitMultiplier": 1,
      "network.maxGossipTopicConcurrency": 64,
      "network.useWorker": true,
      "network.maxYoungGenerationSizeMb": 152,
      "network.targetGroupPeers": 12,
      directPeers: ["/ip4/192.168.1.1/tcp/9000/p2p/16Uiu2HAkuWPWqF4W3aw9oo5Yw79v5muzBaaGTGKMmuqjPfEyfkwu"],

      "sync.isSingleNode": true,
      "sync.disableProcessAsChainSegment": true,
      "sync.backfillBatchSize": 64,
      "sync.disableRangeSync": false,
    } as BeaconNodeArgs;

    const expectedOptions: RecursivePartial<IBeaconNodeOptions> = {
      api: {
        maxGindicesInProof: 1000,
        rest: {
          api: [],
          cors: "*",
          enabled: true,
          address: "127.0.0.1",
          port: 7654,
          headerLimit: 16384,
          bodyLimit: 30e6,
          stacktraces: true,
        },
      },
      chain: {
        blsVerifyAllMultiThread: true,
        blsVerifyAllMainThread: true,
        disableBlsBatchVerify: true,
        persistProducedBlocks: true,
        persistInvalidSszObjects: true,
        proposerBoost: false,
        proposerBoostReorg: false,
        disableImportExecutionFcU: false,
        preaggregateSlotDistance: 1,
        attDataCacheSlotDistance: 2,
        computeUnrealized: true,
        suggestedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        assertCorrectProgressiveBalances: true,
        maxSkipSlots: 100,
        archiveStateEpochFrequency: 1024,
        emitPayloadAttributes: false,
        minSameMessageSignatureSetsToBatch: 32,
        maxShufflingCacheEpochs: 100,
        archiveDataEpochs: 10000,
        archiveMode: ArchiveMode.Frequency,
        nHistoricalStatesFileDataStore: true,
        maxBlockStates: 100,
        maxCPStateEpochsInMemory: 100,
        maxCPStateEpochsOnDisk: 1000,
      },
      executionEngine: {
        urls: ["http://localhost:8551"],
        retries: 1,
        retryDelay: 2000,
        timeout: 12000,
      },
      executionBuilder: {
        enabled: false,
        url: "http://localhost:8661",
        timeout: 12000,
        faultInspectionWindow: 32,
        allowedFaults: 8,
      },
      metrics: {
        enabled: true,
        port: 8765,
        address: "0.0.0.0",
      },
      monitoring: {
        endpoint: "https://beaconcha.in/api/v1/client/metrics?apikey=secretKey&machine=machine1",
        interval: 60000,
        initialDelay: 30000,
        requestTimeout: 10000,
        collectSystemStats: true,
      },
      network: {
        discv5: {
          config: {},
          bindAddrs: {
            ip4: "/ip4/127.0.0.1/udp/9002",
          },
          bootEnrs: [
            "enr:-KG4QOtcP9X1FbIMOe17QNMKqDxCpm14jcX5tiOE4_TyMrFqbmhPZHK_ZPG2Gxb1GE2xdtodOfx9-cgvNtxnRyHEmC0ghGV0aDKQ9aX9QgAAAAD__________4JpZIJ2NIJpcIQDE8KdiXNlY3AyNTZrMaEDhpehBDbZjM_L9ek699Y7vhUJ-eAdMyQW_Fil522Y0fODdGNwgiMog3VkcIIjKA",
          ],
        },
        maxPeers: 30,
        targetPeers: 25,
        localMultiaddrs: ["/ip4/127.0.0.1/tcp/9001"],
        subscribeAllSubnets: true,
        slotsToSubscribeBeforeAggregatorDuty: 1,
        disablePeerScoring: true,
        connectToDiscv5Bootnodes: true,
        discv5FirstQueryDelayMs: 1000,
        dontSendGossipAttestationsToForkchoice: true,
        allowPublishToZeroPeers: true,
        gossipsubD: 4,
        gossipsubDLow: 2,
        gossipsubDHigh: 6,
        gossipsubAwaitHandler: true,
        mdns: false,
        quic: false,
        rateLimitMultiplier: 1,
        maxGossipTopicConcurrency: 64,
        useWorker: true,
        maxYoungGenerationSizeMb: 152,
        targetGroupPeers: 12,
        tcp: true,
        directPeers: ["/ip4/192.168.1.1/tcp/9000/p2p/16Uiu2HAkuWPWqF4W3aw9oo5Yw79v5muzBaaGTGKMmuqjPfEyfkwu"],
      },
      sync: {
        isSingleNode: true,
        slotImportTolerance: 32,
        disableProcessAsChainSegment: true,
        backfillBatchSize: 64,
        disableRangeSync: false,
      },
    };

    const options = parseBeaconNodeArgs(beaconNodeArgsPartial);
    expect(options).toEqual(expectedOptions);
  });
});

describe("options / network / tcp and quic flags", () => {
  it("should include only tcp multiaddrs by default", () => {
    const result = parseNetworkArgs({listenAddress: "0.0.0.0", port: 9000} as NetworkArgs);
    expect(result.localMultiaddrs).toContain("/ip4/0.0.0.0/tcp/9000");
    expect(result.localMultiaddrs).not.toContain("/ip4/0.0.0.0/udp/9001/quic-v1");
  });

  it("should include both tcp and quic multiaddrs when quic is true", () => {
    const result = parseNetworkArgs({listenAddress: "0.0.0.0", port: 9000, quic: true} as NetworkArgs);
    expect(result.localMultiaddrs).toContain("/ip4/0.0.0.0/tcp/9000");
    expect(result.localMultiaddrs).toContain("/ip4/0.0.0.0/udp/9001/quic-v1");
  });

  it("should exclude tcp multiaddrs when tcp is false", () => {
    const result = parseNetworkArgs({listenAddress: "0.0.0.0", port: 9000, tcp: false, quic: true} as NetworkArgs);
    const tcpAddrs = result.localMultiaddrs.filter((mu) => mu.includes("/tcp/"));
    expect(tcpAddrs).toHaveLength(0);
    expect(result.localMultiaddrs).toContain("/ip4/0.0.0.0/udp/9001/quic-v1");
    expect(result.tcp).toBe(false);
  });

  it("should exclude quic multiaddrs when quic is false", () => {
    const result = parseNetworkArgs({listenAddress: "0.0.0.0", port: 9000, quic: false} as NetworkArgs);
    const quicAddrs = result.localMultiaddrs.filter((mu) => mu.includes("/quic"));
    expect(quicAddrs).toHaveLength(0);
    expect(result.localMultiaddrs).toContain("/ip4/0.0.0.0/tcp/9000");
    expect(result.quic).toBe(false);
  });

  it("should not validate derived quicPort when quic is false", () => {
    const result = parseNetworkArgs({listenAddress: "0.0.0.0", port: 65535, quic: false} as NetworkArgs);
    expect(result.localMultiaddrs).toContain("/ip4/0.0.0.0/tcp/65535");
    expect(result.localMultiaddrs).not.toContain("/ip4/0.0.0.0/udp/65536/quic-v1");
  });

  it("should not validate explicit quicPort when quic is false", () => {
    const result = parseNetworkArgs({
      listenAddress: "0.0.0.0",
      port: 9000,
      quic: false,
      quicPort: 65536,
    } as NetworkArgs);
    expect(result.quic).toBe(false);
  });

  it("should exclude ipv6 tcp multiaddrs when tcp is false", () => {
    const result = parseNetworkArgs({
      listenAddress: "0.0.0.0",
      listenAddress6: "::",
      port: 9000,
      tcp: false,
      quic: true,
    } as NetworkArgs);
    const tcpAddrs = result.localMultiaddrs.filter((mu) => mu.includes("/tcp/"));
    expect(tcpAddrs).toHaveLength(0);
    // quic for both ipv4 and ipv6 should still be present
    const quicAddrs = result.localMultiaddrs.filter((mu) => mu.includes("/quic"));
    expect(quicAddrs).toHaveLength(2);
  });

  it("should pass tcp through to network options", () => {
    const result = parseNetworkArgs({listenAddress: "0.0.0.0", port: 9000, tcp: false, quic: true} as NetworkArgs);
    expect(result.tcp).toBe(false);
  });

  it("should throw when both TCP and QUIC are disabled", () => {
    expect(() =>
      parseNetworkArgs({listenAddress: "0.0.0.0", port: 9000, tcp: false, quic: false} as NetworkArgs)
    ).toThrow("Cannot disable both TCP and QUIC transports");
  });

  it("should throw when discoveryPort and quicPort collide", () => {
    expect(() =>
      parseNetworkArgs({
        listenAddress: "0.0.0.0",
        port: 9000,
        discoveryPort: 9001,
        quicPort: 9001,
        quic: true,
      } as NetworkArgs)
    ).toThrow(/discoveryPort and quicPort must not collide/);
  });

  it("should not throw on port collision when quic is false", () => {
    const result = parseNetworkArgs({
      listenAddress: "0.0.0.0",
      port: 9000,
      discoveryPort: 9001,
      quicPort: 9001,
      quic: false,
    } as NetworkArgs);
    expect(result.quic).toBe(false);
  });

  it("should throw when discoveryPort6 and quicPort6 collide", () => {
    expect(() =>
      parseNetworkArgs({
        listenAddress6: "::",
        port6: 9000,
        discoveryPort6: 9001,
        quicPort6: 9001,
        quic: true,
      } as NetworkArgs)
    ).toThrow(/discoveryPort6 and quicPort6 must not collide/);
  });
});
