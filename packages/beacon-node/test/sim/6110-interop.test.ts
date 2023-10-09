import fs from "node:fs";
import {Context} from "mocha";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {bytesToInt, LogLevel, sleep} from "@lodestar/utils";
import {TimestampFormatCode} from "@lodestar/logger";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ChainConfig} from "@lodestar/config";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {capella, eip6110, Epoch, Slot} from "@lodestar/types";
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

    const depositReceipt = 
      {
        amount: 32000000000,
        index: 0,
        pubkey: dataToBytes("0x96a96086cff07df17668f35f7418ef8798079167e3f4f9b72ecde17b28226137cf454ab1dd20ef5d924786ab3483c2f9", 48),
        signature: dataToBytes("0xb1acdb2c4d3df3f1b8d3bfd33421660df358d84d78d16c4603551935f4b67643373e7eb63dcb16ec359be0ec41fee33b03a16e80745f2374ff1d3c352508ac5d857c6476d3c3bcf7e6ca37427c9209f17be3af5264c0e2132b3dd1156c28b4e9", 96),
        withdrawalCredentials: dataToBytes("0x003f5102dabe0a27b1746098d1dc17a5d3fbd478759fea9287e4e419b3c3cef2", 32),
      };
    
    // TODO 6110: Do the following
    // 1. Send raw deposit transaction
    const depositTransaction = "0x02f9021c8217de808459682f008459682f0e830271009442424242424242424242424242424242424242428901bc16d674ec800000b901a422895118000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000120749715de5d1226545c6b3790f515d551a5cc5bf1d49c87a696860554d2fc4f14000000000000000000000000000000000000000000000000000000000000003096a96086cff07df17668f35f7418ef8798079167e3f4f9b72ecde17b28226137cf454ab1dd20ef5d924786ab3483c2f9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020003f5102dabe0a27b1746098d1dc17a5d3fbd478759fea9287e4e419b3c3cef20000000000000000000000000000000000000000000000000000000000000060b1acdb2c4d3df3f1b8d3bfd33421660df358d84d78d16c4603551935f4b67643373e7eb63dcb16ec359be0ec41fee33b03a16e80745f2374ff1d3c352508ac5d857c6476d3c3bcf7e6ca37427c9209f17be3af5264c0e2132b3dd1156c28b4e9c080a09f597089338d7f44f5c59f8230bb38f243849228a8d4e9d2e2956e6050f5b2c7a076486996c7e62802b8f95eee114783e4b403fd11093ba96286ff42c595f24452";
    sendRawTransactionBig(ethRpcUrl, depositTransaction, `${dataPath}/deposit.json`)
      .catch((e) => {
        throw Error(`Fail to send raw deposit transaction: ${e.message}`);
      });

    // 2. Create a payload with depositReceipts
    const newPayload = {
      parentHash: dataToBytes("0xb9203a1bb9ed08e8160522c78039f4b83c7c932012fc3068db7dc9be537f1673", 32),
      feeRecipient: dataToBytes("0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b", 20),
      stateRoot: dataToBytes("0xa78bb828a9a90729de2d236a057a415fc635ef98e3209a634285713b34d278e8", 32),
      logsBloom: dataToBytes("0x10000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000", 256),
      prevRandao: dataToBytes("0x0", 32),
      gasLimit: 30000000,
      gasUsed: 84846,
      timestamp: 20,
      extraData: dataToBytes("0x", 32),
      baseFeePerGas: 7n,
      excessBlobGas : 0n,
      transactions: [
        dataToBytes(depositTransaction, 1073741824)
      ],
      withdrawals: [],
      depositReceipts : [depositReceipt],
      blockNumber: 2,
      blockHash: dataToBytes("0xd1ba8d4c47dd83ea145f39e27ef680ee3db132af6f71727e291bfd34dda66ce4", 32),
      receiptsRoot: dataToBytes("0x79ee3424eb720a3ad4b1c5a372bb8160580cbe4d893778660f34213c685627a9", 32),
      blobGasUsed : 0n
    }
    const payloadResult = await executionEngine.notifyNewPayload(ForkName.eip6110, newPayload, [], dataToBytes("0x0", 32));
    if (payloadResult.status !== ExecutionPayloadStatus.VALID) {
      throw Error("getPayload returned payload that notifyNewPayload deems invalid");
    }

    // 3. Update fork choice
    const finalizedBlockHash = "0xd1ba8d4c47dd83ea145f39e27ef680ee3db132af6f71727e291bfd34dda66ce4";
    const preparePayloadParams: PayloadAttributes = {
      // Note: this is created with a pre-defined genesis.json
      timestamp: 30,
      prevRandao: dataToBytes("0x0", 32),
      suggestedFeeRecipient: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
      withdrawals: [],
      parentBeaconBlockRoot: dataToBytes("0x0", 32),
    };

    const payloadId = await executionEngine.notifyForkchoiceUpdate(
      ForkName.eip6110,
      finalizedBlockHash,
      //use finalizedBlockHash as safeBlockHash
      finalizedBlockHash,
      finalizedBlockHash,
      preparePayloadParams
    );
    if (!payloadId) throw Error("InvalidPayloadId");


    // 4. Get the payload. Check depositReceipts field contains deposit
    const payloadAndBlockValue = await executionEngine.getPayload(ForkName.eip6110, payloadId);
    const payload = payloadAndBlockValue.executionPayload as eip6110.ExecutionPayload;
    
    if (payload.transactions[0] !== dataToBytes(depositTransaction, 1073741824)) {
      throw Error("Missing transaction")
    }

    if (payload.depositReceipts[0] !== depositReceipt) {
      throw Error("Missing deposit")
    }

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

