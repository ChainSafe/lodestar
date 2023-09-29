import fs from "node:fs";
import {Context} from "mocha";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {bytesToInt, LogLevel, sleep} from "@lodestar/utils";
import {TimestampFormatCode} from "@lodestar/logger";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ChainConfig} from "@lodestar/config";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";
import {ValidatorProposerConfig} from "@lodestar/validator";

import {ChainEvent} from "../../src/chain/index.js";
import {ClockEvent} from "../../src/util/clock.js";
import {initializeExecutionEngine} from "../../src/execution/index.js";
import {bytesToData, dataToBytes} from "../../src/eth1/provider/utils.js";
import {ExecutionPayloadStatus, PayloadAttributes} from "../../src/execution/engine/interface.js";

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
import {defaultExecutionEngineHttpOpts} from "../../src/execution/engine/http.js";

// NOTE: How to run
// DEV_RUN=true EL_BINARY_DIR=hyperledger/besu:23.7.3 EL_SCRIPT_DIR=besudocker yarn mocha test/sim/6110-interop.test.ts
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
  this.timeout("10min");

  const dataPath = fs.mkdtempSync("lodestar-test-6110");
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
  after(async () => {
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

  it("Send stub payloads to EL", async () => {
    const {elClient, tearDownCallBack} = await runEL(
      {...elSetupConfig, mode: ELStartMode.PostMerge, genesisTemplate: "6110.tmpl"},
      {...elRunOptions, ttd: BigInt(0)},
      controller.signal
    );
    afterEachCallbacks.push(() => tearDownCallBack());
    const {genesisBlockHash, engineRpcUrl, ethRpcUrl} = elClient;
    console.log({genesisBlockHash});

    const executionEngine = initializeExecutionEngine(
      {mode: "http", urls: [engineRpcUrl], jwtSecretHex, retryAttempts, retryDelay},
      {signal: controller.signal, logger: testLogger("executionEngine")}
    );

    const depositReceiptsVector = [
      {
        amount: 320000000000,
        index: 0n,
        pubkey: "0x96a96086cff07df17668f35f7418ef8798079167e3f4f9b72ecde17b28226137cf454ab1dd20ef5d924786ab3483c2f9",
        signature: "0xb1acdb2c4d3df3f1b8d3bfd33421660df358d84d78d16c4603551935f4b67643373e7eb63dcb16ec359be0ec41fee33b03a16e80745f2374ff1d3c352508ac5d857c6476d3c3bcf7e6ca37427c9209f17be3af5264c0e2132b3dd1156c28b4e9",
        withdrawalCredentials: "0x003f5102dabe0a27b1746098d1dc17a5d3fbd478759fea9287e4e419b3c3cef2"
      }
    ]

    const deposits = depositReceiptsVector.map((testVec) => ({
      pubkey: dataToBytes(testVec.pubkey, 48),
      withdrawalCredentials: dataToBytes(testVec.withdrawalCredentials, 32),
      amount: testVec.amount,
      signature: dataToBytes(testVec.signature, 96),
      index: testVec.index,
    }));

    const depositTransaction = "0x02f9021c8217de808459682f008459682f0e830271009442424242424242424242424242424242424242428901bc16d674ec800000b901a422895118000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000120749715de5d1226545c6b3790f515d551a5cc5bf1d49c87a696860554d2fc4f14000000000000000000000000000000000000000000000000000000000000003096a96086cff07df17668f35f7418ef8798079167e3f4f9b72ecde17b28226137cf454ab1dd20ef5d924786ab3483c2f9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020003f5102dabe0a27b1746098d1dc17a5d3fbd478759fea9287e4e419b3c3cef20000000000000000000000000000000000000000000000000000000000000060b1acdb2c4d3df3f1b8d3bfd33421660df358d84d78d16c4603551935f4b67643373e7eb63dcb16ec359be0ec41fee33b03a16e80745f2374ff1d3c352508ac5d857c6476d3c3bcf7e6ca37427c9209f17be3af5264c0e2132b3dd1156c28b4e9c080a09f597089338d7f44f5c59f8230bb38f243849228a8d4e9d2e2956e6050f5b2c7a076486996c7e62802b8f95eee114783e4b403fd11093ba96286ff42c595f24452";

    // TODO 6110: Do the following
    // 1. Send raw deposit transaction
    // 2. Prepare a payload
      // With depositReceipts
    // 3. Update fork choice
    // 4. Get the payload
      // Check depositReceipts field contains deposit
  });

  it("Post-merge, run for a few blocks", async function () {
    console.log("\n\nPost-merge, run for a few blocks\n\n");
    const {elClient, tearDownCallBack} = await runEL(
      {...elSetupConfig, mode: ELStartMode.PostMerge, genesisTemplate: "6110.tmpl"},
      {...elRunOptions, ttd: BigInt(0)},
      controller.signal
    );
    afterEachCallbacks.push(() => tearDownCallBack());

    await runNodeWithEL.bind(this)({
      elClient,
      denebEpoch: 0,
      testName: "post-merge",
    });
  });

  async function runNodeWithEL(
    this: Context,
    {elClient, denebEpoch, testName}: {elClient: ELClient; denebEpoch: Epoch; testName: string}
  ): Promise<void> {
    // TODO 6110: Implment it
  }
});

