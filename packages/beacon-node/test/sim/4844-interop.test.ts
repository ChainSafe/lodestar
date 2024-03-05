import fs from "node:fs";
import {describe, it, vi, afterAll, afterEach} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {LogLevel, sleep} from "@lodestar/utils";
import {TimestampFormatCode} from "@lodestar/logger";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ChainConfig} from "@lodestar/config";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";
import {ValidatorProposerConfig} from "@lodestar/validator";

import {ChainEvent} from "../../src/chain/index.js";
import {ClockEvent} from "../../src/util/clock.js";

import {testLogger, TestLoggerOpts} from "../utils/logger.js";
import {getDevBeaconNode} from "../utils/node/beacon.js";
import {BeaconRestApiServerOpts} from "../../src/api/index.js";
import {simTestInfoTracker} from "../utils/node/simTest.js";
import {getAndInitDevValidators} from "../utils/node/validator.js";
import {BeaconNode, Eth1Provider} from "../../src/index.js";
import {ZERO_HASH} from "../../src/constants/index.js";
import {runEL, ELStartMode, ELClient, sendRawTransactionBig} from "../utils/runEl.js";
import {logFilesDir} from "./params.js";
import {shell} from "./shell.js";

// NOTE: How to run
// DEV_RUN=true EL_BINARY_DIR=g11tech/ethereumjs:devnet6-32aaac EL_SCRIPT_DIR=ethereumjsdocker yarn vitest --run test/sim/4844-interop.test.ts
// ```

/* eslint-disable no-console, @typescript-eslint/naming-convention */

const jwtSecretHex = "0xdc6457099f127cf0bac78de8b297df04951281909db4f58b43def7c7151e765d";
const blobTxsPath = "./test/sim/data/blobs.txt";
describe("executionEngine / ExecutionEngineHttp", function () {
  if (!process.env.EL_BINARY_DIR || !process.env.EL_SCRIPT_DIR) {
    throw Error(
      `EL ENV must be provided, EL_BINARY_DIR: ${process.env.EL_BINARY_DIR}, EL_SCRIPT_DIR: ${process.env.EL_SCRIPT_DIR}`
    );
  }
  vi.setConfig({testTimeout: 1000 * 60 * 10, hookTimeout: 1000 * 60 * 10});

  const dataPath = fs.mkdtempSync("lodestar-test-4844");
  const elSetupConfig = {
    elScriptDir: process.env.EL_SCRIPT_DIR,
    elBinaryDir: process.env.EL_BINARY_DIR,
  };
  const elRunOptions = {
    dataPath,
    jwtSecretHex,
    enginePort: parseInt(process.env.ENGINE_PORT ?? "8551"),
    ethPort: parseInt(process.env.ETH_PORT ?? "8545"),
  };

  const controller = new AbortController();
  afterAll(async () => {
    controller?.abort();
    await shell(`sudo rm -rf ${dataPath}`);
  });

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  it("Post-merge, run for a few blocks", async function () {
    console.log("\n\nPost-merge, run for a few blocks\n\n");
    const {elClient, tearDownCallBack} = await runEL(
      {...elSetupConfig, mode: ELStartMode.PostMerge, genesisTemplate: "4844.tmpl"},
      {...elRunOptions, ttd: BigInt(0)},
      controller.signal
    );
    afterEachCallbacks.push(() => tearDownCallBack());

    await runNodeWithEL({
      elClient,
      denebEpoch: 0,
      testName: "post-merge",
    });
  });

  async function runNodeWithEL({
    elClient,
    denebEpoch,
    testName,
  }: {
    elClient: ELClient;
    denebEpoch: Epoch;
    testName: string;
  }): Promise<void> {
    const {genesisBlockHash, ttd, engineRpcUrl, ethRpcUrl} = elClient;
    const validatorClientCount = 1;
    const validatorsPerClient = 8;

    const testParams: Pick<ChainConfig, "SECONDS_PER_SLOT"> = {
      SECONDS_PER_SLOT: 2,
    };

    // Just finish the run within first epoch as we only need to test if withdrawals started
    const expectedEpochsToFinish = 1;
    // 1 epoch of margin of error
    const epochsOfMargin = 1;
    const timeoutSetupMargin = 30 * 1000; // Give extra 30 seconds of margin

    // delay a bit so that test is over the startup cpu surge that can cause timeouts
    // somehow this seems to be dependent on the number of the bns we start which calls
    // for some debugging
    const genesisSlotsDelay = 30;

    // On the emprical runs 11 blobs are processed, leaving 3 blobs marging
    const expectedBlobs = 8;

    // Keep timeout high for variour sync modes to be tested
    const timeout =
      ((epochsOfMargin + 10 * expectedEpochsToFinish) * SLOTS_PER_EPOCH + genesisSlotsDelay) *
      testParams.SECONDS_PER_SLOT *
      1000;
    vi.setConfig({testTimeout: timeout + 2 * timeoutSetupMargin});

    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * testParams.SECONDS_PER_SLOT;

    const testLoggerOpts: TestLoggerOpts = {
      level: LogLevel.info,
      file: {
        filepath: `${logFilesDir}/4844-${testName}.log`,
        level: LogLevel.debug,
      },
      timestampFormat: {
        format: TimestampFormatCode.EpochSlot,
        genesisTime,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        secondsPerSlot: testParams.SECONDS_PER_SLOT,
      },
    };
    const loggerNodeA = testLogger("Node-A", testLoggerOpts);

    const bn = await getDevBeaconNode({
      params: {
        ...testParams,
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        TERMINAL_TOTAL_DIFFICULTY: ttd,
      },
      options: {
        api: {rest: {enabled: true} as BeaconRestApiServerOpts},
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true, rateLimitMultiplier: 0},
        // Now eth deposit/merge tracker methods directly available on engine endpoints
        eth1: {enabled: false, providerUrls: [engineRpcUrl], jwtSecretHex},
        executionEngine: {urls: [engineRpcUrl], jwtSecretHex},
        chain: {suggestedFeeRecipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
      },
      validatorCount: validatorClientCount * validatorsPerClient,
      logger: loggerNodeA,
      genesisTime,
      eth1BlockHash: fromHexString(genesisBlockHash),
      withEth1Credentials: true,
    });

    afterEachCallbacks.push(async function () {
      await bn.close();
      await sleep(1000);
    });

    const stopInfoTracker = simTestInfoTracker(bn, loggerNodeA);
    const valProposerConfig = {
      defaultConfig: {
        feeRecipient: "0xcccccccccccccccccccccccccccccccccccccccc",
      },
    } as ValidatorProposerConfig;
    const {data: bnIdentity} = await bn.api.node.getNetworkIdentity();

    const {validators} = await getAndInitDevValidators({
      logPrefix: "Node-A",
      node: bn,
      validatorsPerClient,
      validatorClientCount,
      startIndex: 0,
      testLoggerOpts,
      valProposerConfig,
    });

    afterEachCallbacks.push(async function () {
      await Promise.all(validators.map((v) => v.close()));
    });

    // Start range sync from the bn but using the same execution node
    const loggerNodeB = testLogger("Node-B", {
      ...testLoggerOpts,
      file: {
        filepath: `${logFilesDir}/4844-${testName}-B.log`,
        level: LogLevel.debug,
      },
    });
    const unknownSyncBN = await getDevBeaconNode({
      params: {
        ...testParams,
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        TERMINAL_TOTAL_DIFFICULTY: ttd,
      },
      options: {
        api: {rest: {enabled: false} as BeaconRestApiServerOpts},
        network: {allowPublishToZeroPeers: true, discv5: null},
        // Now eth deposit/merge tracker methods directly available on engine endpoints
        eth1: {enabled: false, providerUrls: [engineRpcUrl], jwtSecretHex},
        executionEngine: {urls: [engineRpcUrl], jwtSecretHex},
        chain: {
          disableImportExecutionFcU: true,
        },
      },
      validatorCount: validatorClientCount * validatorsPerClient,
      logger: loggerNodeB,
      genesisTime,
      eth1BlockHash: fromHexString(genesisBlockHash),
      withEth1Credentials: true,
    });

    // Start range sync from the bn but using the same execution node
    const loggerNodeC = testLogger("Node-C", {
      ...testLoggerOpts,
      file: {
        filepath: `${logFilesDir}/4844-${testName}-C.log`,
        level: LogLevel.debug,
      },
    });
    const rangeSyncBN = await getDevBeaconNode({
      params: {
        ...testParams,
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        TERMINAL_TOTAL_DIFFICULTY: ttd,
      },
      options: {
        api: {rest: {enabled: false} as BeaconRestApiServerOpts},
        network: {allowPublishToZeroPeers: true, discv5: null},
        // Now eth deposit/merge tracker methods directly available on engine endpoints
        eth1: {enabled: false, providerUrls: [engineRpcUrl], jwtSecretHex},
        executionEngine: {urls: [engineRpcUrl], jwtSecretHex},
        chain: {
          disableImportExecutionFcU: true,
        },
      },
      validatorCount: validatorClientCount * validatorsPerClient,
      logger: loggerNodeC,
      genesisTime,
      eth1BlockHash: fromHexString(genesisBlockHash),
      withEth1Credentials: true,
    });

    const blobTxs = getBlobTxsFromFile(blobTxsPath);
    let blobTxsIdx = 0;

    bn.chain.clock.on(ClockEvent.slot, (slot) => {
      // send raw tx every other slot
      if (slot > 0 && slot % 2 === 1 && blobTxs[blobTxsIdx] !== undefined) {
        sendRawTransactionBig(ethRpcUrl, blobTxs[blobTxsIdx], `${dataPath}/blobTx-${blobTxsIdx}.json`)
          .then(() => {
            // increment if blobTx has been transmitted successfully
            blobTxsIdx++;
          })
          .catch((e) => {
            loggerNodeA.error("failed to send raw blob tx", {slot, blobTxsIdx}, e);
          });
      }
    });

    // let bn run for some time and then connect rangeSyncBN
    await new Promise<void>((resolve, _reject) => {
      bn.chain.clock.on(ClockEvent.epoch, (epoch) => {
        // Resolve only if the finalized checkpoint includes execution payload
        if (epoch >= expectedEpochsToFinish) {
          console.log(`\nGot event ${ClockEvent.epoch}, stopping validators and nodes\n`);
          resolve();
        }
      });
    });

    // unknownSyncBN should startup in Synced mode and the gossip should cause unknown parent error
    // resulting into sync by root of all the parents
    await unknownSyncBN.api.lodestar.connectPeer(bnIdentity.peerId, bnIdentity.p2pAddresses);
    await new Promise<void>((resolve, _reject) => {
      unknownSyncBN.chain.emitter.on(ChainEvent.forkChoiceFinalized, (finalizedCheckpoint) => {
        // Resolve only if the finalized checkpoint includes execution payload
        if (finalizedCheckpoint.epoch >= expectedEpochsToFinish) {
          console.log(`\nGot event ${ChainEvent.forkChoiceFinalized}, stopping validators and nodes\n`);
          resolve();
        }
      });
    });

    // rangeSyncBN should start in syncing mode and range sync through req/resp
    await rangeSyncBN.api.lodestar.connectPeer(bnIdentity.peerId, bnIdentity.p2pAddresses);
    await new Promise<void>((resolve, _reject) => {
      rangeSyncBN.chain.emitter.on(ChainEvent.forkChoiceFinalized, (finalizedCheckpoint) => {
        // Resolve only if the finalized checkpoint includes execution payload
        if (finalizedCheckpoint.epoch >= expectedEpochsToFinish) {
          console.log(`\nGot event ${ChainEvent.forkChoiceFinalized}, stopping validators and nodes\n`);
          resolve();
        }
      });
    });

    const bnHeadSlot = Math.min(
      bn.chain.forkChoice.getHead().slot,
      unknownSyncBN.chain.forkChoice.getHead().slot,
      rangeSyncBN.chain.forkChoice.getHead().slot
    );
    const foundBlobs = await retrieveCanonicalBlobs(bn, computeStartSlotAtEpoch(denebEpoch), bnHeadSlot);

    const foundBlobsUnknownSync = await retrieveCanonicalBlobs(
      unknownSyncBN,
      computeStartSlotAtEpoch(denebEpoch),
      bnHeadSlot
    );

    const foundBlobsRangeSyncBN = await retrieveCanonicalBlobs(
      rangeSyncBN,
      computeStartSlotAtEpoch(denebEpoch),
      bnHeadSlot
    );

    if (foundBlobs !== foundBlobsUnknownSync || foundBlobs !== foundBlobsRangeSyncBN) {
      throw Error(
        `Blobs not synced foundBlobs=${foundBlobs} foundBlobsUnknownSync=${foundBlobsUnknownSync} foundBlobsRangeSyncBN=${foundBlobsRangeSyncBN}`
      );
    }

    // Stop chain and un-subscribe events so the execution engine won't update it's head
    // Allow some time to broadcast finalized events and complete the importBlock routine
    await Promise.all(validators.map((v) => v.close()));
    await bn.close();
    await sleep(500);

    if (bn.chain.beaconProposerCache.get(1) !== "0xcccccccccccccccccccccccccccccccccccccccc") {
      throw Error("Invalid feeRecipient set at BN");
    }

    // Assertions to make sure the end state is good
    // 1. The proper head is set
    const rpc = new Eth1Provider({DEPOSIT_CONTRACT_ADDRESS: ZERO_HASH}, {providerUrls: [engineRpcUrl], jwtSecretHex});
    const consensusHead = bn.chain.forkChoice.getHead();
    const executionHeadBlock = await rpc.getBlockByNumber("latest");

    if (!executionHeadBlock) throw Error("Execution has not head block");
    if (consensusHead.executionPayloadBlockHash !== executionHeadBlock.hash) {
      throw Error(
        "Consensus head not equal to execution head: " +
          JSON.stringify({
            executionHeadBlockHash: executionHeadBlock.hash,
            consensusHeadExecutionPayloadBlockHash: consensusHead.executionPayloadBlockHash,
            consensusHeadSlot: consensusHead.slot,
          })
      );
    }

    // Simple check to confirm that withdrawals were mostly processed
    if (foundBlobs < expectedBlobs) {
      throw Error(`4844 blobs ${foundBlobs} < ${expectedBlobs}`);
    }

    // wait for 1 slot to print current epoch stats
    await sleep(1 * bn.config.SECONDS_PER_SLOT * 1000);
    stopInfoTracker();
    console.log("\n\nDone\n\n");
  }
});

async function retrieveCanonicalBlobs(bn: BeaconNode, fromSlot: Slot, toSlot: Slot): Promise<number> {
  let eip4844Blobs = 0;
  for (let slot = fromSlot; slot <= toSlot; slot++) {
    const blobSideCars = await bn.api.beacon.getBlobSidecars(slot).catch((_e: Error) => {
      return null;
    });
    if (blobSideCars) {
      eip4844Blobs += blobSideCars.data.length;
    }
  }

  return eip4844Blobs;
}

function getBlobTxsFromFile(blobsPath: string): string[] {
  const file = fs.readFileSync(blobsPath, "utf-8");
  return file.split("\n").filter((txn) => txn.length > 0);
}
