import fs from "node:fs";
import {describe, it, vi, afterAll, afterEach} from "vitest";
import _ from "lodash";
import {LogLevel, sleep} from "@lodestar/utils";
import {ForkName, SLOTS_PER_EPOCH, UNSET_DEPOSIT_RECEIPTS_START_INDEX} from "@lodestar/params";
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
// DEV_RUN=true EL_BINARY_DIR=naviechan/besu:v6110 EL_SCRIPT_DIR=besudocker yarn vitest --run test/sim/electra-interop.test.ts
// or
// DEV_RUN=true EL_BINARY_DIR=/Volumes/fast_boi/navie/Documents/workspace/besu/build/install/besu/bin EL_SCRIPT_DIR=besu yarn vitest --run test/sim/electra-interop.test.ts
// ```

/* eslint-disable no-console, @typescript-eslint/naming-convention */

const jwtSecretHex = "0xdc6457099f127cf0bac78de8b297df04951281909db4f58b43def7c7151e765d";
const retryAttempts = defaultExecutionEngineHttpOpts.retryAttempts;
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

  it("Send and get payloads with depositReceipts to/from EL", async () => {
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
      {mode: "http", urls: [engineRpcUrl], jwtSecretHex, retryAttempts, retryDelay},
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
      "0x02f9021c8217de808459682f008459682f0e830271009442424242424242424242424242424242424242428901bc16d674ec800000b901a422895118000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000120749715de5d1226545c6b3790f515d551a5cc5bf1d49c87a696860554d2fc4f14000000000000000000000000000000000000000000000000000000000000003096a96086cff07df17668f35f7418ef8798079167e3f4f9b72ecde17b28226137cf454ab1dd20ef5d924786ab3483c2f9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020003f5102dabe0a27b1746098d1dc17a5d3fbd478759fea9287e4e419b3c3cef20000000000000000000000000000000000000000000000000000000000000060b1acdb2c4d3df3f1b8d3bfd33421660df358d84d78d16c4603551935f4b67643373e7eb63dcb16ec359be0ec41fee33b03a16e80745f2374ff1d3c352508ac5d857c6476d3c3bcf7e6ca37427c9209f17be3af5264c0e2132b3dd1156c28b4e9c080a09f597089338d7f44f5c59f8230bb38f243849228a8d4e9d2e2956e6050f5b2c7a076486996c7e62802b8f95eee114783e4b403fd11093ba96286ff42c595f24452";
    const depositReceiptA = {
      amount: 32000000000,
      index: 0,
      pubkey: dataToBytes(
        "0x96a96086cff07df17668f35f7418ef8798079167e3f4f9b72ecde17b28226137cf454ab1dd20ef5d924786ab3483c2f9",
        48
      ),
      signature: dataToBytes(
        "0xb1acdb2c4d3df3f1b8d3bfd33421660df358d84d78d16c4603551935f4b67643373e7eb63dcb16ec359be0ec41fee33b03a16e80745f2374ff1d3c352508ac5d857c6476d3c3bcf7e6ca37427c9209f17be3af5264c0e2132b3dd1156c28b4e9",
        96
      ),
      withdrawalCredentials: dataToBytes("0x003f5102dabe0a27b1746098d1dc17a5d3fbd478759fea9287e4e419b3c3cef2", 32),
    };

    const depositTransactionB =
      "0x02f9021c8217de018459682f008459682f0e830271009442424242424242424242424242424242424242428901bc16d674ec800000b901a422895118000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000120a18b4c7cab0afa273ea9504904521ea8421a4e32740b7611bd3d5095ca99f0cb0000000000000000000000000000000000000000000000000000000000000030a5c85a60ba2905c215f6a12872e62b1ee037051364244043a5f639aa81b04a204c55e7cc851f29c7c183be253ea1510b000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020001db70c485b6264692f26b8aeaab5b0c384180df8e2184a21a808a3ec8e86ca00000000000000000000000000000000000000000000000000000000000000609561731785b48cf1886412234531e4940064584463e96ac63a1a154320227e333fb51addc4a89b7e0d3f862d7c1fd4ea03bd8eb3d8806f1e7daf591cbbbb92b0beb74d13c01617f22c5026b4f9f9f294a8a7c32db895de3b01bee0132c9209e1c001a0644e0a763a34b4bfb9f56a677857b57fcf15e3db57e2f57060e92084f75f3d82a018ba8eaacbd8e6f6917675b1d0362b12ca82850ca8ef9c010430760c2b2e0cb5";
    const depositReceiptB = {
      amount: 32000000000,
      index: 1,
      pubkey: dataToBytes(
        "0xa5c85a60ba2905c215f6a12872e62b1ee037051364244043a5f639aa81b04a204c55e7cc851f29c7c183be253ea1510b",
        48
      ),
      signature: dataToBytes(
        "0x9561731785b48cf1886412234531e4940064584463e96ac63a1a154320227e333fb51addc4a89b7e0d3f862d7c1fd4ea03bd8eb3d8806f1e7daf591cbbbb92b0beb74d13c01617f22c5026b4f9f9f294a8a7c32db895de3b01bee0132c9209e1",
        96
      ),
      withdrawalCredentials: dataToBytes("0x001db70c485b6264692f26b8aeaab5b0c384180df8e2184a21a808a3ec8e86ca", 32),
    };

    sendRawTransactionBig(ethRpcUrl, depositTransactionA, `${dataPath}/deposit.json`).catch((e: Error) => {
      loggerExecutionEngine.error("Fail to send raw deposit transaction A", undefined, e);
    });

    sendRawTransactionBig(ethRpcUrl, depositTransactionB, `${dataPath}/deposit.json`).catch((e: Error) => {
      loggerExecutionEngine.error("Fail to send raw deposit transaction B", undefined, e);
    });

    // 3. Import new payload with tx A and deposit receipt A
    const newPayloadBlockHash = "0xfd1189e6ea0814b7d40d4e50b31ae5feabbb2acff39399457bbdda7cb5ccd490";
    const newPayload = {
      parentHash: dataToBytes("0x26118cf71453320edcebbc4ebb34af5b578087a32385b80108bf691fa23efc42", 32),
      feeRecipient: dataToBytes("0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b", 20),
      stateRoot: dataToBytes("0x14208ac0e218167936e220b72d5d5887a963cb858ea2f2d268518f014a3da3fa", 32),
      logsBloom: dataToBytes(
        "0x10000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000",
        256
      ),
      prevRandao: dataToBytes("0x0000000000000000000000000000000000000000000000000000000000000000", 32),
      gasLimit: 30000000,
      gasUsed: 84846,
      timestamp: 16,
      extraData: dataToBytes("0x", 0),
      baseFeePerGas: 7n,
      excessBlobGas: 0n,
      transactions: [dataToBytes(depositTransactionA, null)],
      withdrawals: [],
      depositReceipts: [depositReceiptA],
      blockNumber: 1,
      blockHash: dataToBytes(newPayloadBlockHash, 32),
      receiptsRoot: dataToBytes("0x79ee3424eb720a3ad4b1c5a372bb8160580cbe4d893778660f34213c685627a9", 32),
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

    // 5. Get the payload.  Check depositReceipts field contains deposit
    // Wait a bit first for besu to pick up tx from the tx pool.
    await sleep(1000);
    const payloadAndBlockValue = await executionEngine.getPayload(ForkName.electra, payloadId2);
    const payload = payloadAndBlockValue.executionPayload as electra.ExecutionPayload;

    if (payload.transactions.length !== 1) {
      throw Error(`Number of transactions mismatched. Expected: 1, actual: ${payload.transactions.length}`);
    } else {
      const actualTransaction = bytesToData(payload.transactions[0]);

      if (actualTransaction !== depositTransactionB) {
        throw Error(`Transaction mismatched. Expected: ${depositTransactionB}, actual: ${actualTransaction}`);
      }
    }

    if (payload.depositReceipts.length !== 1) {
      throw Error(`Number of depositReceipts mismatched. Expected: 1, actual: ${payload.depositReceipts.length}`);
    }

    const actualDepositReceipt = payload.depositReceipts[0];
    if (!_.isEqual(actualDepositReceipt, depositReceiptB)) {
      throw Error(
        `Deposit receipts mismatched. Expected: ${JSON.stringify(depositReceiptB)}, actual: ${JSON.stringify(
          actualDepositReceipt
        )}`
      );
    }
  });

  it("Post-merge, run for a few blocks", async function () {
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
   * 1) Send two raw deposit transactions, and see if two new validators with corrent balances show up in the state.validators and unfinalized cache
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
      "0x02f9021e8217de8085012a05f20085019254d380830271009442424242424242424242424242424242424242428901bc16d674ec800000b901a422895118000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000120ef950826b191ebea0bbafa92a2c6bffa8239c6f456d92891ce2852b8360f0d30000000000000000000000000000000000000000000000000000000000000003095e4f91aea91a9e00387fad9d60997cff6cbf68d42d1b6629a7b248cdef255f94a2a2381e5d4125273fe42da5f7aa0e1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020003f5102dabe0a27b1746098d1dc17a5d3fbd478759fea9287e4e419b3c3cef20000000000000000000000000000000000000000000000000000000000000060b6c06e65228046268aa918baf78e072c25e65aa0bcf258cefcac3371c47df81bc4d43ca942f5fc28f9a563e925fd9c5010bc8c300add3faf3af0d61fabaaf03694020feaafb03e47c1bc4fcf082684c7ed3f7d5839d1722214b24f95ad2b226cc080a0be1161617492e4ca2fcb89edcadf5e71e8cac0d6447d18cfde9b55e5a8412417a07ec8c47dd484036c745049bb2e2980d44e38d4dacac50dc4a14a2f23c52f2e5f";
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

    if (headState.depositReceiptsStartIndex === UNSET_DEPOSIT_RECEIPTS_START_INDEX) {
      throw Error("state.depositReceiptsStartIndex is not set upon processing new deposit receipt");
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
