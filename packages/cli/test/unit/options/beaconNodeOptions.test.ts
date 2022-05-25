import {expect} from "chai";
import fs from "node:fs";
import {IBeaconNodeOptions} from "@chainsafe/lodestar";
import {LogLevel, RecursivePartial} from "@chainsafe/lodestar-utils";
import {parseBeaconNodeArgs, IBeaconNodeArgs} from "../../../src/options/beaconNodeOptions/index.js";
import {getTestdirPath} from "../../utils.js";

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
      "chain.defaultFeeRecipient": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
      "metrics.port": 8765,
      "metrics.address": "0.0.0.0",

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
      "network.allowPublishToZeroPeers": true,
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
        defaultFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
        port: 8765,
        address: "0.0.0.0",
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
        allowPublishToZeroPeers: true,
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
      "eth1.enabled": true,
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
