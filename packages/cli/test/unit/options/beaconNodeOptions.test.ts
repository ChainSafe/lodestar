import fs from "node:fs";
import {expect} from "chai";
import {IBeaconNodeOptions} from "@lodestar/beacon-node";
import {RecursivePartial} from "@lodestar/utils";
import {parseBeaconNodeArgs, IBeaconNodeArgs} from "../../../src/options/beaconNodeOptions/index.js";
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
      "rest.bodyLimit": 30e6,

      "chain.blsVerifyAllMultiThread": true,
      "chain.blsVerifyAllMainThread": true,
      "chain.disableBlsBatchVerify": true,
      "chain.persistInvalidSszObjects": true,
      "chain.proposerBoostEnabled": false,
      "chain.disableImportExecutionFcU": false,
      "chain.computeUnrealized": true,
      "chain.countUnrealizedFull": true,
      suggestedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "chain.assertCorrectProgressiveBalances": true,
      "chain.maxSkipSlots": 100,
      "safe-slots-to-import-optimistically": 256,

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
      "builder.urls": ["http://localhost:8661"],
      "builder.timeout": 12000,

      metrics: true,
      "metrics.port": 8765,
      "metrics.address": "0.0.0.0",

      discv5: true,
      listenAddress: "127.0.0.1",
      port: 9001,
      discoveryPort: 9002,
      bootnodes: ["enr:-somedata"],
      targetPeers: 25,
      subscribeAllSubnets: true,
      "network.maxPeers": 30,
      "network.connectToDiscv5Bootnodes": true,
      "network.discv5FirstQueryDelayMs": 1000,
      "network.requestCountPeerLimit": 5,
      "network.blockCountTotalLimit": 1000,
      "network.blockCountPeerLimit": 500,
      "network.rateTrackerTimeoutMs": 60000,
      "network.dontSendGossipAttestationsToForkchoice": true,
      "network.allowPublishToZeroPeers": true,
      "network.gossipsubDParam": 4,
      "network.gossipsubDParamLow": 2,
      "network.gossipsubDParamHigh": 6,

      "sync.isSingleNode": true,
      "sync.disableProcessAsChainSegment": true,
      "sync.backfillBatchSize": 64,
    } as IBeaconNodeArgs;

    const expectedOptions: RecursivePartial<IBeaconNodeOptions> = {
      api: {
        maxGindicesInProof: 1000,
        rest: {
          api: [],
          cors: "*",
          enabled: true,
          address: "127.0.0.1",
          port: 7654,
          bodyLimit: 30e6,
        },
      },
      chain: {
        blsVerifyAllMultiThread: true,
        blsVerifyAllMainThread: true,
        disableBlsBatchVerify: true,
        persistInvalidSszObjects: true,
        proposerBoostEnabled: false,
        disableImportExecutionFcU: false,
        computeUnrealized: true,
        countUnrealizedFull: true,
        safeSlotsToImportOptimistically: 256,
        suggestedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        assertCorrectProgressiveBalances: true,
        maxSkipSlots: 100,
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
        urls: ["http://localhost:8661"],
        timeout: 12000,
      },
      metrics: {
        enabled: true,
        port: 8765,
        address: "0.0.0.0",
      },
      network: {
        discv5: {
          enabled: true,
          bindAddr: "/ip4/127.0.0.1/udp/9002",
          bootEnrs: ["enr:-somedata"],
        },
        maxPeers: 30,
        targetPeers: 25,
        localMultiaddrs: ["/ip4/127.0.0.1/tcp/9001"],
        subscribeAllSubnets: true,
        connectToDiscv5Bootnodes: true,
        discv5FirstQueryDelayMs: 1000,
        requestCountPeerLimit: 5,
        blockCountTotalLimit: 1000,
        blockCountPeerLimit: 500,
        rateTrackerTimeoutMs: 60000,
        dontSendGossipAttestationsToForkchoice: true,
        allowPublishToZeroPeers: true,
        gossipsubDParam: 4,
        gossipsubDParamLow: 2,
        gossipsubDParamHigh: 6,
      },
      sync: {
        isSingleNode: true,
        disableProcessAsChainSegment: true,
        backfillBatchSize: 64,
      },
    };

    const options = parseBeaconNodeArgs(beaconNodeArgsPartial);
    expect(options).to.deep.equal(expectedOptions);
  });

  it("Should use execution endpoint & jwt for eth1", () => {
    const jwtSecretFile = getTestdirPath("./jwtsecret");
    const jwtSecretHex = "0xdc6457099f127cf0bac78de8b297df04951281909db4f58b43def7c7151e765d";
    fs.writeFileSync(jwtSecretFile, jwtSecretHex, {encoding: "utf8"});

    // Cast to match the expected fully defined type
    const beaconNodeArgsPartial = {
      eth1: true,
      "execution.urls": ["http://my.node:8551"],
      "jwt-secret": jwtSecretFile,
    } as IBeaconNodeArgs;

    const expectedOptions: RecursivePartial<IBeaconNodeOptions> = {
      eth1: {
        enabled: true,
        providerUrls: ["http://my.node:8551"],
        jwtSecretHex,
      },
    };

    const options = parseBeaconNodeArgs(beaconNodeArgsPartial);
    expect(options.eth1).to.deep.equal(expectedOptions.eth1);
  });
});
