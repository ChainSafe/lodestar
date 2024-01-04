import fs from "node:fs";
import {describe, it, expect} from "vitest";
import {IBeaconNodeOptions} from "@lodestar/beacon-node";
import {RecursivePartial} from "@lodestar/utils";
import {parseBeaconNodeArgs, BeaconNodeArgs} from "../../../src/options/beaconNodeOptions/index.js";
import {getTestdirPath} from "../../utils.js";

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

      "chain.blsVerifyAllMultiThread": true,
      "chain.blsVerifyAllMainThread": true,
      "chain.disableBlsBatchVerify": true,
      "chain.persistProducedBlocks": true,
      "chain.persistInvalidSszObjects": true,
      "chain.proposerBoostEnabled": false,
      "chain.disableImportExecutionFcU": false,
      "chain.preaggregateSlotDistance": 1,
      "chain.attDataCacheSlotDistance": 2,
      "chain.computeUnrealized": true,
      suggestedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "chain.assertCorrectProgressiveBalances": true,
      "chain.maxSkipSlots": 100,
      "safe-slots-to-import-optimistically": 256,
      "chain.archiveStateEpochFrequency": 1024,
      "chain.trustedSetup": "",
      "chain.minSameMessageSignatureSetsToBatch": 32,
      "chain.maxShufflingCacheEpochs": 100,
      "chain.nHistoricalStates": true,
      "chain.maxBlockStates": 100,
      "chain.maxCPStateEpochsInMemory": 100,
      emitPayloadAttributes: false,

      eth1: true,
      "eth1.providerUrl": "http://my.node:8545",
      "eth1.providerUrls": ["http://my.node:8545"],
      "eth1.depositContractDeployBlock": 1625314,
      "eth1.disableEth1DepositDataTracker": true,
      "eth1.unsafeAllowDepositDataOverwrite": false,
      "eth1.forcedEth1DataVote":
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",

      "execution.urls": ["http://localhost:8551"],
      "execution.timeout": 12000,
      "execution.retryDelay": 2000,
      "execution.retryAttempts": 1,

      builder: false,
      "builder.url": "http://localhost:8661",
      "builder.timeout": 12000,
      "builder.faultInspectionWindow": 32,
      "builder.allowedFaults": 16,

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
      bootnodes: [
        "enr:-KG4QOtcP9X1FbIMOe17QNMKqDxCpm14jcX5tiOE4_TyMrFqbmhPZHK_ZPG2Gxb1GE2xdtodOfx9-cgvNtxnRyHEmC0ghGV0aDKQ9aX9QgAAAAD__________4JpZIJ2NIJpcIQDE8KdiXNlY3AyNTZrMaEDhpehBDbZjM_L9ek699Y7vhUJ-eAdMyQW_Fil522Y0fODdGNwgiMog3VkcIIjKA",
      ],
      targetPeers: 25,
      deterministicLongLivedAttnets: true,
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
      "network.beaconAttestationBatchValidation": true,
      "network.allowPublishToZeroPeers": true,
      "network.gossipsubD": 4,
      "network.gossipsubDLow": 2,
      "network.gossipsubDHigh": 6,
      "network.gossipsubAwaitHandler": true,
      "network.rateLimitMultiplier": 1,
      "network.maxGossipTopicConcurrency": 64,
      "network.useWorker": true,
      "network.maxYoungGenerationSizeMb": 152,

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
        },
      },
      chain: {
        blsVerifyAllMultiThread: true,
        blsVerifyAllMainThread: true,
        disableBlsBatchVerify: true,
        persistProducedBlocks: true,
        persistInvalidSszObjects: true,
        proposerBoostEnabled: false,
        disableImportExecutionFcU: false,
        preaggregateSlotDistance: 1,
        attDataCacheSlotDistance: 2,
        computeUnrealized: true,
        safeSlotsToImportOptimistically: 256,
        suggestedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        assertCorrectProgressiveBalances: true,
        maxSkipSlots: 100,
        archiveStateEpochFrequency: 1024,
        emitPayloadAttributes: false,
        trustedSetup: "",
        minSameMessageSignatureSetsToBatch: 32,
        maxShufflingCacheEpochs: 100,
        nHistoricalStates: true,
        maxBlockStates: 100,
        maxCPStateEpochsInMemory: 100,
      },
      eth1: {
        enabled: true,
        providerUrls: ["http://my.node:8545"],
        depositContractDeployBlock: 1625314,
        disableEth1DepositDataTracker: true,
        unsafeAllowDepositDataOverwrite: false,
        forcedEth1DataVote:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      executionEngine: {
        urls: ["http://localhost:8551"],
        retryAttempts: 1,
        retryDelay: 2000,
        timeout: 12000,
      },
      executionBuilder: {
        enabled: false,
        url: "http://localhost:8661",
        timeout: 12000,
        faultInspectionWindow: 32,
        allowedFaults: 16,
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
        deterministicLongLivedAttnets: true,
        subscribeAllSubnets: true,
        slotsToSubscribeBeforeAggregatorDuty: 1,
        disablePeerScoring: true,
        connectToDiscv5Bootnodes: true,
        discv5FirstQueryDelayMs: 1000,
        dontSendGossipAttestationsToForkchoice: true,
        beaconAttestationBatchValidation: true,
        allowPublishToZeroPeers: true,
        gossipsubD: 4,
        gossipsubDLow: 2,
        gossipsubDHigh: 6,
        gossipsubAwaitHandler: true,
        mdns: false,
        rateLimitMultiplier: 1,
        maxGossipTopicConcurrency: 64,
        useWorker: true,
        maxYoungGenerationSizeMb: 152,
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

  it("Should use execution endpoint & jwt for eth1", () => {
    const jwtSecretFile = getTestdirPath("./jwtsecret");
    const jwtSecretHex = "0xdc6457099f127cf0bac78de8b297df04951281909db4f58b43def7c7151e765d";
    fs.writeFileSync(jwtSecretFile, jwtSecretHex, {encoding: "utf8"});

    // Cast to match the expected fully defined type
    const beaconNodeArgsPartial = {
      eth1: true,
      "execution.urls": ["http://my.node:8551"],
      jwtSecret: jwtSecretFile,
    } as BeaconNodeArgs;

    const expectedOptions: RecursivePartial<IBeaconNodeOptions> = {
      eth1: {
        enabled: true,
        providerUrls: ["http://my.node:8551"],
        jwtSecretHex,
      },
    };

    const options = parseBeaconNodeArgs(beaconNodeArgsPartial);
    expect(options.eth1).toEqual(expectedOptions.eth1);
  });
});
