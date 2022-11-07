import fs from "node:fs";
import {toHexString} from "@chainsafe/ssz";
import {ForkSeq} from "@lodestar/params";

import {ExecutePayloadStatus} from "../../src/execution/engine/interface.js";
import {ExecutionEngineHttp} from "../../src/execution/engine/http.js";
import {bytesToData, dataToBytes} from "../../src/eth1/provider/utils.js";
import {defaultExecutionEngineHttpOpts} from "../../src/execution/engine/http.js";
import {runEL, ELStartMode} from "../utils/runEl.js";
import {shell} from "./shell.js";

// NOTE: How to run
// EL_BINARY_DIR=g11tech/geth:withdrawals EL_SCRIPT_DIR=gethdocker yarn mocha test/sim/withdrawal-interop.test.ts
// ```

/* eslint-disable no-console, @typescript-eslint/naming-convention, quotes */

const jwtSecretHex = "0xdc6457099f127cf0bac78de8b297df04951281909db4f58b43def7c7151e765d";
const retryAttempts = defaultExecutionEngineHttpOpts.retryAttempts;
const retryDelay = defaultExecutionEngineHttpOpts.retryDelay;
const GWEI_TO_WEI = BigInt(1000000000);

describe("executionEngine / ExecutionEngineHttp", function () {
  if (!process.env.EL_BINARY_DIR || !process.env.EL_SCRIPT_DIR) {
    throw Error(
      `EL ENV must be provided, EL_BINARY_DIR: ${process.env.EL_BINARY_DIR}, EL_SCRIPT_DIR: ${process.env.EL_SCRIPT_DIR}`
    );
  }
  this.timeout("10min");

  const dataPath = fs.mkdtempSync("lodestar-test-withdrawal");
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
      {...elSetupConfig, mode: ELStartMode.PostMerge, template: "genesisPostWithdraw.tmpl"},
      {...elRunOptions, ttd: BigInt(0)},
      controller.signal
    );
    afterEachCallbacks.push(() => tearDownCallBack());
    const {genesisBlockHash, engineRpcUrl} = elClient;
    console.log({genesisBlockHash});

    //const controller = new AbortController();
    const executionEngine = new ExecutionEngineHttp(
      {urls: [engineRpcUrl], jwtSecretHex, retryAttempts, retryDelay},
      {signal: controller.signal}
    );

    const withdrawalsVector = [
      {Index: 0, Validator: 65535, Recipient: "0x0000000000000000000000000000000000000000", Amount: "0"},
      {
        Index: 1,
        Validator: 65536,
        Recipient: "0x0100000000000000000000000000000000000000",
        Amount: "452312848583266388373324160190187140051835877600158453279131187530910662656",
      },
      {
        Index: 2,
        Validator: 65537,
        Recipient: "0x0200000000000000000000000000000000000000",
        Amount: "904625697166532776746648320380374280103671755200316906558262375061821325312",
      },
      {
        Index: 3,
        Validator: 65538,
        Recipient: "0x0300000000000000000000000000000000000000",
        Amount: "1356938545749799165119972480570561420155507632800475359837393562592731987968",
      },
      {
        Index: 4,
        Validator: 65539,
        Recipient: "0x0400000000000000000000000000000000000000",
        Amount: "1809251394333065553493296640760748560207343510400633813116524750123642650624",
      },
      {
        Index: 5,
        Validator: 65540,
        Recipient: "0x0500000000000000000000000000000000000000",
        Amount: "2261564242916331941866620800950935700259179388000792266395655937654553313280",
      },
      {
        Index: 6,
        Validator: 65541,
        Recipient: "0x0600000000000000000000000000000000000000",
        Amount: "2713877091499598330239944961141122840311015265600950719674787125185463975936",
      },
      {
        Index: 7,
        Validator: 65542,
        Recipient: "0x0700000000000000000000000000000000000000",
        Amount: "3166189940082864718613269121331309980362851143201109172953918312716374638592",
      },
    ];

    const withdrawals = withdrawalsVector.map((testVec) => ({
      index: testVec.Index,
      validatorIndex: testVec.Validator,
      address: dataToBytes(testVec.Recipient),
      amount: BigInt(testVec.Amount) / GWEI_TO_WEI,
    }));

    const preparePayloadParams = {
      // Note: this is created with a pre-defined genesis.json
      timestamp: 47,
      prevRandao: dataToBytes("0xff00000000000000000000000000000000000000000000000000000000000000"),
      suggestedFeeRecipient: "0xaa00000000000000000000000000000000000000",
      withdrawals,
    };
    const finalizedBlockHash = "0x3b8fb240d288781d4aac94d3fd16809ee413bc99294a085798a589dae51ddd4a";

    // 1. Prepare a payload
    const payloadId = await executionEngine.notifyForkchoiceUpdate(
      ForkSeq.capella,
      genesisBlockHash,
      //use finalizedBlockHash as safeBlockHash
      finalizedBlockHash,
      finalizedBlockHash,
      preparePayloadParams
    );
    if (!payloadId) throw Error("InvalidPayloadId");

    // 2. Get the payload
    const payload = await executionEngine.getPayload(ForkSeq.capella, payloadId);
    if (toHexString(payload.blockHash) !== "0x48349ed336bf7e262299b16263f2a12f797fe62970580d7858672aa700e886fa") {
      throw Error(`Invalid blockHash`);
    }

    // 3. Execute the payload
    const payloadResult = await executionEngine.notifyNewPayload(ForkSeq.capella, payload);
    if (payloadResult.status !== ExecutePayloadStatus.VALID) {
      throw Error("getPayload returned payload that notifyNewPayload deems invalid");
    }

    // 4. Update the fork choice
    await executionEngine.notifyForkchoiceUpdate(
      ForkSeq.capella,
      bytesToData(payload.blockHash),
      genesisBlockHash,
      genesisBlockHash
    );
  });
});
