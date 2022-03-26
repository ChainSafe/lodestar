import {expect} from "chai";
import {IBeaconNodeOptions} from "@chainsafe/lodestar";
import {LogLevel, RecursivePartial} from "@chainsafe/lodestar-utils";
import {parseBeaconNodeArgs, IBeaconNodeArgs} from "../../../src/options/beaconNodeOptions";

describe("options / beaconNodeOptions", () => {
  it("Should parse BeaconNodeArgs", () => {
    // Cast to match the expected fully defined type
    const beaconNodeArgsPartial = {
      "api.maxGindicesInProof": 1000,
      "api.rest.api": [],
      "api.rest.cors": "*",
      "api.rest.enabled": true,
      "api.rest.host": "127.0.0.1",
      "api.rest.port": 7654,

      "chain.blsVerifyAllMultiThread": true,
      "chain.blsVerifyAllMainThread": true,
      "chain.disableBlsBatchVerify": true,
      "chain.persistInvalidSszObjects": true,
      "chain.proposerBoostEnabled": false,
      "safe-slots-to-import-optimistically": 256,

      "eth1.enabled": true,
      "eth1.providerUrl": "http://my.node:8545",
      "eth1.providerUrls": ["http://my.node:8545"],
      "eth1.depositContractDeployBlock": 1625314,
      "eth1.disableEth1DepositDataTracker": true,
      "eth1.unsafeAllowDepositDataOverwrite": false,

      "execution.urls": ["http://localhost:8550"],
      "execution.timeout": 12000,

      "logger.eth1.level": "debug",
      "logger.unknown.level": "debug",

      "metrics.enabled": true,
      "metrics.gatewayUrl": "http://localhost:8000",
      "metrics.serverPort": 8765,
      "metrics.timeout": 5000,
      "metrics.listenAddr": "0.0.0.0",

      "network.discv5.enabled": true,
      "network.discv5.bindAddr": "addr",
      "network.discv5.bootEnrs": ["enr:-somedata"],
      "network.maxPeers": 30,
      "network.targetPeers": 25,
      "network.bootMultiaddrs": [],
      "network.localMultiaddrs": [],
      "network.subscribeAllSubnets": true,
      "network.connectToDiscv5Bootnodes": true,
      "network.discv5FirstQueryDelayMs": 1000,
      "network.requestCountPeerLimit": 5,
      "network.blockCountTotalLimit": 1000,
      "network.blockCountPeerLimit": 500,
      "network.rateTrackerTimeoutMs": 60000,
      "network.dontSendGossipAttestationsToForkchoice": true,
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
          host: "127.0.0.1",
          port: 7654,
        },
      },
      chain: {
        blsVerifyAllMultiThread: true,
        blsVerifyAllMainThread: true,
        disableBlsBatchVerify: true,
        persistInvalidSszObjects: true,
        proposerBoostEnabled: false,
        safeSlotsToImportOptimistically: 256,
      },
      eth1: {
        enabled: true,
        providerUrls: ["http://my.node:8545"],
        depositContractDeployBlock: 1625314,
        disableEth1DepositDataTracker: true,
        unsafeAllowDepositDataOverwrite: false,
      },
      executionEngine: {
        urls: ["http://localhost:8550"],
        timeout: 12000,
      },
      logger: {
        eth1: {
          level: LogLevel.debug,
        },
      },
      metrics: {
        enabled: true,
        gatewayUrl: "http://localhost:8000",
        serverPort: 8765,
        timeout: 5000,
        listenAddr: "0.0.0.0",
      },
      network: {
        discv5: {
          enabled: true,
          bindAddr: "addr",
          bootEnrs: ["enr:-somedata"],
        },
        maxPeers: 30,
        targetPeers: 25,
        bootMultiaddrs: [],
        localMultiaddrs: [],
        subscribeAllSubnets: true,
        connectToDiscv5Bootnodes: true,
        discv5FirstQueryDelayMs: 1000,
        requestCountPeerLimit: 5,
        blockCountTotalLimit: 1000,
        blockCountPeerLimit: 500,
        rateTrackerTimeoutMs: 60000,
        dontSendGossipAttestationsToForkchoice: true,
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
});
