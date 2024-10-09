import fs from "node:fs";
import assert from "node:assert";
import {describe, it, vi, afterAll, afterEach} from "vitest";

import {LogLevel, sleep} from "@lodestar/utils";
import {ForkName, SLOTS_PER_EPOCH, UNSET_DEPOSIT_REQUESTS_START_INDEX} from "@lodestar/params";
import {electra, Epoch, Slot} from "@lodestar/types";
import {ValidatorProposerConfig} from "@lodestar/validator";

import {ChainConfig} from "@lodestar/config";
import {TimestampFormatCode} from "@lodestar/logger";
import {CachedBeaconStateElectra} from "@lodestar/state-transition";
import {initializeExecutionEngine} from "../../src/execution/index.js";
import {ExecutionPayloadStatus, PayloadAttributes} from "../../src/execution/engine/interface.js";

import {testLogger, TestLoggerOpts} from "../utils/logger.js";
import {runEL, ELStartMode, ELClient, sendRawTransactionBig} from "../utils/runEl.js";
import {defaultExecutionEngineHttpOpts} from "../../src/execution/engine/http.js";
import {getDevBeaconNode} from "../utils/node/beacon.js";
import {BeaconRestApiServerOpts} from "../../src/api/index.js";
import {simTestInfoTracker} from "../utils/node/simTest.js";
import {getAndInitDevValidators} from "../utils/node/validator.js";
import {ClockEvent} from "../../src/util/clock.js";
import {dataToBytes} from "../../src/eth1/provider/utils.js";
import {bytesToData} from "../../lib/eth1/provider/utils.js";
import {BeaconNode} from "../../src/index.js";
import {logFilesDir} from "./params.js";
import {shell} from "./shell.js";

// NOTE: How to run
// DEV_RUN=true EL_BINARY_DIR=ethpandaops/ethereumjs:master-0e06ddf EL_SCRIPT_DIR=ethereumjsdocker yarn vitest --run test/sim/electra-interop.test.ts
// ```

/* eslint-disable no-console, @typescript-eslint/naming-convention */

const jwtSecretHex = "0xdc6457099f127cf0bac78de8b297df04951281909db4f58b43def7c7151e765d";
const retries = defaultExecutionEngineHttpOpts.retries;
const retryDelay = defaultExecutionEngineHttpOpts.retryDelay;
describe("executionEngine / ExecutionEngineHttp", function () {
  if (!process.env.EL_BINARY_DIR || !process.env.EL_SCRIPT_DIR) {
    throw Error(
      `EL ENV must be provided, EL_BINARY_DIR: ${process.env.EL_BINARY_DIR}, EL_SCRIPT_DIR: ${process.env.EL_SCRIPT_DIR}`
    );
  }
  vi.setConfig({testTimeout: 1000 * 60 * 10, hookTimeout: 1000 * 60 * 10});

  const dataPath = fs.mkdtempSync("lodestar-test-electra");
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

  it("Send and get payloads with depositRequests to/from EL", async () => {
    const {elClient, tearDownCallBack} = await runEL(
      {...elSetupConfig, mode: ELStartMode.PostMerge, genesisTemplate: "electra.tmpl"},
      {...elRunOptions, ttd: BigInt(0)},
      controller.signal
    );
    afterEachCallbacks.push(() => tearDownCallBack());
    const {genesisBlockHash, engineRpcUrl, ethRpcUrl} = elClient;
    console.log({genesisBlockHash});

    const loggerExecutionEngine = testLogger("executionEngine");

    const executionEngine = initializeExecutionEngine(
      {mode: "http", urls: [engineRpcUrl], jwtSecretHex, retries, retryDelay},
      {signal: controller.signal, logger: loggerExecutionEngine}
    );

    // 1. Prepare payload
    const preparePayloadParams: PayloadAttributes = {
      // Note: this is created with a pre-defined genesis.json
      timestamp: 10,
      prevRandao: dataToBytes("0x0000000000000000000000000000000000000000000000000000000000000000", 32),
      suggestedFeeRecipient: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
      withdrawals: [],
      parentBeaconBlockRoot: dataToBytes("0x0000000000000000000000000000000000000000000000000000000000000000", 32),
    };
    const payloadId = await executionEngine.notifyForkchoiceUpdate(
      ForkName.electra,
      genesisBlockHash,
      //use finalizedBlockHash as safeBlockHash
      genesisBlockHash,
      genesisBlockHash,
      preparePayloadParams
    );
    if (!payloadId) throw Error("InvalidPayloadId");

    // 2. Send raw deposit transaction A and B. tx A is to be imported via newPayload, tx B is to be included in payload via getPayload
    const depositTransactionA =
      "0x02f90213018080648401c9c3809400000000219ab540356cbb839cbe05303d7705fa8901bc16d674ec800000b901a422895118000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001208cd4e5a69709cf8ee5b1b73d6efbf3f33bcac92fb7e4ce62b2467542fb50a72d0000000000000000000000000000000000000000000000000000000000000030ac842878bb70009552a4cfcad801d6e659c50bd50d7d03306790cb455ce7363c5b6972f0159d170f625a99b2064dbefc000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020010000000000000000000000818ccb1c4eda80270b04d6df822b1e72dd83c3030000000000000000000000000000000000000000000000000000000000000060a747f75c72d0cf0d2b52504c7385b516f0523e2f0842416399f42b4aee5c6384a5674f6426b1cc3d0827886fa9b909e616f5c9f61f986013ed2b9bf37071cbae951136265b549f44e3c8e26233c0433e9124b7fd0dc86e82f9fedfc0a179d769c080a067c9857d27a42f8fde4d5cf2d6c324af94469ac93ec867eacdd9002e1297835fa07927224866e03d51fb1ae94390e7aec453cad8df9e048892e98f945178eab254";
    const depositRequestA = {
      amount: 32000000000,
      index: 0,
      pubkey: dataToBytes(
        "0xac842878bb70009552a4cfcad801d6e659c50bd50d7d03306790cb455ce7363c5b6972f0159d170f625a99b2064dbefc",
        48
      ),
      signature: dataToBytes(
        "0xa747f75c72d0cf0d2b52504c7385b516f0523e2f0842416399f42b4aee5c6384a5674f6426b1cc3d0827886fa9b909e616f5c9f61f986013ed2b9bf37071cbae951136265b549f44e3c8e26233c0433e9124b7fd0dc86e82f9fedfc0a179d769",
        96
      ),
      withdrawalCredentials: dataToBytes("0x010000000000000000000000818ccb1c4eda80270b04d6df822b1e72dd83c303", 32),
    };

    const depositTransactionB =
      "0x02f90213010180648401c9c3809400000000219ab540356cbb839cbe05303d7705fa8901bc16d674ec800000b901a422895118000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000120a7ec6a3459bf9389265f62abbdffcd0ef20924bd03e4856d3b964edf565bd8e80000000000000000000000000000000000000000000000000000000000000030a5290ddb9abd6a7fb8bac3414c6c7ff093a18ff297c1eada20464de388b14aafa505bfc98847ca7e6f7ca3aa9d4ca769000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020010000000000000000000000da628fed218cbe3a9e684a9f51c49dd63a229a1d000000000000000000000000000000000000000000000000000000000000006080e12262f94795ce3453f17eea2dd44843ff7977d303b192c1d2a4ce0dbebc8856c398d6445cbf244ba9e99307ead1e30b2544a5e9693cdd5196a33c46e2dd8a8b83afc8278c1ea79cd5c13cac2b96a62257b3636787d0f1e0f881c50a4667ddc080a0b653aad27e504d4fcd19b7c317ffbd2a26a81d6ac14ecea6a891a63dcf7816dfa02953273b4cddc93b2a9ba21aaeb0db988cb1086319dd0b91f79bc101adfe32e4";
    const depositRequestB = {
      amount: 32000000000,
      index: 1,
      pubkey: dataToBytes(
        "0xa5290ddb9abd6a7fb8bac3414c6c7ff093a18ff297c1eada20464de388b14aafa505bfc98847ca7e6f7ca3aa9d4ca769",
        48
      ),
      signature: dataToBytes(
        "0x80e12262f94795ce3453f17eea2dd44843ff7977d303b192c1d2a4ce0dbebc8856c398d6445cbf244ba9e99307ead1e30b2544a5e9693cdd5196a33c46e2dd8a8b83afc8278c1ea79cd5c13cac2b96a62257b3636787d0f1e0f881c50a4667dd",
        96
      ),
      withdrawalCredentials: dataToBytes("0x010000000000000000000000da628fed218cbe3a9e684a9f51c49dd63a229a1d", 32),
    };

    sendRawTransactionBig(ethRpcUrl, depositTransactionA, `${dataPath}/deposit.json`).catch((e: Error) => {
      loggerExecutionEngine.error("Fail to send raw deposit transaction A", undefined, e);
    });

    sendRawTransactionBig(ethRpcUrl, depositTransactionB, `${dataPath}/deposit.json`).catch((e: Error) => {
      loggerExecutionEngine.error("Fail to send raw deposit transaction B", undefined, e);
    });

    // 3. Import new payload with tx A and deposit receipt A
    const newPayloadBlockHash = "0x4cec1852552239cf78e8bd2db35ff9396acb6b40c3ce486e6e3028bc75c9faec";
    const newPayload = {
      parentHash: dataToBytes("0xeb86e5aca89ea5477a6e169a389efbbe7e5a3d5f5c5296bcde3a4b032ea9bae8", 32),
      feeRecipient: dataToBytes("0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b", 20),
      stateRoot: dataToBytes("0x686ce0478cabce79b298712fefee4aefd2fac1ab4a4813936d2c1ccca788bbc3", 32),
      logsBloom: dataToBytes(
        "0x00000000000000000000400000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000020000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000",
        256
      ),
      prevRandao: dataToBytes("0x0000000000000000000000000000000000000000000000000000000000000000", 32),
      gasLimit: 30000000,
      gasUsed: 84714,
      timestamp: 16,
      extraData: dataToBytes("0x", 0),
      baseFeePerGas: 7n,
      excessBlobGas: 0n,
      transactions: [dataToBytes(depositTransactionA, null)],
      withdrawals: [],
      depositRequests: [depositRequestA],
      blockNumber: 1,
      blockHash: dataToBytes(newPayloadBlockHash, 32),
      receiptsRoot: dataToBytes("0x0b67bea29f17eeb290685e01e9a2e4cd77a83471d9985a8ce27997a7ed3ee3f8", 32),
      blobGasUsed: 0n,
    };
    const parentBeaconBlockRoot = dataToBytes("0x0000000000000000000000000000000000000000000000000000000000000000", 32);
    const payloadResult = await executionEngine.notifyNewPayload(
      ForkName.electra,
      newPayload,
      [],
      parentBeaconBlockRoot
    );
    if (payloadResult.status !== ExecutionPayloadStatus.VALID) {
      throw Error("getPayload returned payload that notifyNewPayload deems invalid");
    }

    // 4. Update fork choice
    const preparePayloadParams2: PayloadAttributes = {
      timestamp: 48,
      prevRandao: dataToBytes("0x0000000000000000000000000000000000000000000000000000000000000000", 32),
      suggestedFeeRecipient: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
      withdrawals: [],
      parentBeaconBlockRoot: dataToBytes("0x0000000000000000000000000000000000000000000000000000000000000000", 32),
    };

    const payloadId2 = await executionEngine.notifyForkchoiceUpdate(
      ForkName.electra,
      newPayloadBlockHash,
      //use finalizedBlockHash as safeBlockHash
      newPayloadBlockHash,
      newPayloadBlockHash,
      preparePayloadParams2
    );
    if (!payloadId2) throw Error("InvalidPayloadId");

    // 5. Get the payload.  Check depositRequests field contains deposit
    // Wait a bit first for besu to pick up tx from the tx pool.
    await sleep(1000);
    const payloadAndBlockValue = await executionEngine.getPayload(ForkName.electra, payloadId2);
    const payload = payloadAndBlockValue.executionPayload as electra.ExecutionPayload;
    const depositRequests = payloadAndBlockValue.executionRequests?.deposits;

    if (payload.transactions.length !== 1) {
      throw Error(`Number of transactions mismatched. Expected: 1, actual: ${payload.transactions.length}`);
    } else {
      const actualTransaction = bytesToData(payload.transactions[0]);

      if (actualTransaction !== depositTransactionB) {
        throw Error(`Transaction mismatched. Expected: ${depositTransactionB}, actual: ${actualTransaction}`);
      }
    }

    if (depositRequests === undefined || depositRequests.length !== 1) {
      throw Error(`Number of depositRequests mismatched. Expected: 1, actual: ${depositRequests?.length}`);
    }

    const actualDepositRequest = depositRequests[0];
    assert.deepStrictEqual(
      actualDepositRequest,
      depositRequestB,
      `Deposit receipts mismatched. Expected: ${JSON.stringify(depositRequestB)}, actual: ${JSON.stringify(
        actualDepositRequest
      )}`
    );
  });

  // TODO: get this post merge run working
  it.skip("Post-merge, run for a few blocks", async function () {
    console.log("\n\nPost-merge, run for a few blocks\n\n");
    const {elClient, tearDownCallBack} = await runEL(
      {...elSetupConfig, mode: ELStartMode.PostMerge, genesisTemplate: "electra.tmpl"},
      {...elRunOptions, ttd: BigInt(0)},
      controller.signal
    );
    afterEachCallbacks.push(() => tearDownCallBack());

    await runNodeWithEL({
      elClient,
      electraEpoch: 0,
      testName: "post-merge",
    });
  });

  /**
   * Want to test two things:
   * 1) Send two raw deposit transactions, and see if two new validators with correct balances show up in the state.validators and unfinalized cache
   * 2) Upon state-transition, see if the two new validators move from unfinalized cache to finalized cache
   */
  async function runNodeWithEL({
    elClient,
    electraEpoch,
    testName,
  }: {
    elClient: ELClient;
    electraEpoch: Epoch;
    testName: string;
  }): Promise<void> {
    const {genesisBlockHash, ttd, engineRpcUrl, ethRpcUrl} = elClient;
    const validatorClientCount = 1;
    const validatorsPerClient = 32;

    const testParams: Pick<ChainConfig, "SECONDS_PER_SLOT"> = {
      SECONDS_PER_SLOT: 2,
    };

    // Just enough to have a checkpoint finalized
    const expectedEpochsToFinish = 4;
    // 1 epoch of margin of error
    const epochsOfMargin = 1;
    const timeoutSetupMargin = 30 * 1000; // Give extra 30 seconds of margin

    // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
    const genesisSlotsDelay = 8;

    const timeout =
      ((epochsOfMargin + expectedEpochsToFinish) * SLOTS_PER_EPOCH + genesisSlotsDelay) *
      testParams.SECONDS_PER_SLOT *
      1000;

    vi.setConfig({testTimeout: timeout + 2 * timeoutSetupMargin});

    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * testParams.SECONDS_PER_SLOT;

    const testLoggerOpts: TestLoggerOpts = {
      level: LogLevel.info,
      file: {
        filepath: `${logFilesDir}/mergemock-${testName}.log`,
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
        ELECTRA_FORK_EPOCH: electraEpoch,
        TERMINAL_TOTAL_DIFFICULTY: ttd,
      },
      options: {
        api: {rest: {enabled: true} as BeaconRestApiServerOpts},
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true, discv5: null},
        // Now eth deposit/merge tracker methods directly available on engine endpoints
        eth1: {enabled: false, providerUrls: [engineRpcUrl], jwtSecretHex},
        executionEngine: {urls: [engineRpcUrl], jwtSecretHex},
        chain: {suggestedFeeRecipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
      },
      validatorCount: validatorClientCount * validatorsPerClient,
      logger: loggerNodeA,
      genesisTime,
      eth1BlockHash: dataToBytes(genesisBlockHash, 32),
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

    const {validators} = await getAndInitDevValidators({
      node: bn,
      logPrefix: "Node-A",
      validatorsPerClient,
      validatorClientCount,
      startIndex: 0,
      // At least one sim test must use the REST API for beacon <-> validator comms
      useRestApi: true,
      testLoggerOpts,
      valProposerConfig,
    });

    afterEachCallbacks.push(async function () {
      await Promise.all(validators.map((v) => v.close()));
    });

    await waitForSlot(bn, 1);

    // send raw tx at slot 1
    const depositTransaction =
      "0x02f90213018080648401c9c3809400000000219ab540356cbb839cbe05303d7705fa8901bc16d674ec800000b901a422895118000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001208cd4e5a69709cf8ee5b1b73d6efbf3f33bcac92fb7e4ce62b2467542fb50a72d0000000000000000000000000000000000000000000000000000000000000030ac842878bb70009552a4cfcad801d6e659c50bd50d7d03306790cb455ce7363c5b6972f0159d170f625a99b2064dbefc000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020010000000000000000000000818ccb1c4eda80270b04d6df822b1e72dd83c3030000000000000000000000000000000000000000000000000000000000000060a747f75c72d0cf0d2b52504c7385b516f0523e2f0842416399f42b4aee5c6384a5674f6426b1cc3d0827886fa9b909e616f5c9f61f986013ed2b9bf37071cbae951136265b549f44e3c8e26233c0433e9124b7fd0dc86e82f9fedfc0a179d769c080a067c9857d27a42f8fde4d5cf2d6c324af94469ac93ec867eacdd9002e1297835fa07927224866e03d51fb1ae94390e7aec453cad8df9e048892e98f945178eab254";
    sendRawTransactionBig(ethRpcUrl, depositTransaction, `${dataPath}/deposit.json`).catch((e: Error) => {
      loggerNodeA.error("Fail to send raw deposit transaction", undefined, e);
    });

    await waitForSlot(bn, 5);
    // Expect new validator to be in unfinalized cache, in state.validators and not in finalized cache
    let headState = bn.chain.getHeadState();
    let epochCtx = headState.epochCtx;
    if (headState.validators.length !== 33 || headState.balances.length !== 33) {
      throw Error("New validator is not reflected in the beacon state at slot 5");
    }
    if (epochCtx.index2pubkey.length !== 32 || epochCtx.pubkey2index.size !== 32) {
      throw Error("Finalized cache is modified.");
    }
    if (epochCtx.unfinalizedPubkey2index.size !== 1) {
      throw Error(
        `Unfinalized cache is missing the expected validator. Size: ${epochCtx.unfinalizedPubkey2index.size}`
      );
    }
    // validator count at epoch 1 should be empty at this point since no epoch transition has happened.
    if (epochCtx.getValidatorCountAtEpoch(1) !== undefined) {
      throw Error("Historical validator lengths is modified");
    }

    await new Promise<void>((resolve, _reject) => {
      bn.chain.clock.on(ClockEvent.epoch, (epoch) => {
        // Resolve only if the finalized checkpoint includes execution payload
        if (epoch >= expectedEpochsToFinish) {
          console.log("\nGot event epoch, stopping validators and nodes\n");
          resolve();
        }
      });
    });

    // Stop chain and un-subscribe events so the execution engine won't update it's head
    // Allow some time to broadcast finalized events and complete the importBlock routine
    await Promise.all(validators.map((v) => v.close()));
    await bn.close();
    await sleep(500);

    // Check if new validator is in finalized cache
    headState = bn.chain.getHeadState() as CachedBeaconStateElectra;
    epochCtx = headState.epochCtx;

    if (headState.validators.length !== 33 || headState.balances.length !== 33) {
      throw Error("New validator is not reflected in the beacon state.");
    }
    if (epochCtx.index2pubkey.length !== 33 || epochCtx.pubkey2index.size !== 33) {
      throw Error("New validator is not in finalized cache");
    }
    if (!epochCtx.unfinalizedPubkey2index.isEmpty()) {
      throw Error("Unfinalized cache still contains new validator");
    }
    // After 4 epochs, headState's finalized cp epoch should be 2
    // epochCtx should only have validator count for epoch 3 and 4.
    if (epochCtx.getValidatorCountAtEpoch(4) === undefined || epochCtx.getValidatorCountAtEpoch(3) === undefined) {
      throw Error("Missing historical validator length for epoch 3 or 4");
    }

    if (epochCtx.getValidatorCountAtEpoch(4) !== 33 || epochCtx.getValidatorCountAtEpoch(3) !== 33) {
      throw Error("Incorrect historical validator length for epoch 3 or 4");
    }

    if (epochCtx.getValidatorCountAtEpoch(2) !== undefined || epochCtx.getValidatorCountAtEpoch(1) !== undefined) {
      throw Error("Historical validator length for epoch 1 or 2 is not dropped properly");
    }

    if (headState.depositRequestsStartIndex === UNSET_DEPOSIT_REQUESTS_START_INDEX) {
      throw Error("state.depositRequestsStartIndex is not set upon processing new deposit receipt");
    }

    // wait for 1 slot to print current epoch stats
    await sleep(1 * bn.config.SECONDS_PER_SLOT * 1000);
    stopInfoTracker();
    console.log("\n\nDone\n\n");
  }
});

async function waitForSlot(bn: BeaconNode, targetSlot: Slot): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    bn.chain.clock.on(ClockEvent.slot, (currentSlot) => {
      if (currentSlot === targetSlot) {
        resolve();
        return;
      }
      if (currentSlot > targetSlot) {
        reject(Error(`Beacon node has passed target slot ${targetSlot}. Current slot ${currentSlot}`));
      }
    });
  });
}
