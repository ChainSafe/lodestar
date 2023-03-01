import "mocha";
import {promisify} from "node:util";
import {expect} from "chai";
import leveldown from "leveldown";
import {sleep} from "@lodestar/utils";
import {LevelDbController} from "@lodestar/db";

import {fromHexString, toHexString} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {Eth1ForBlockProduction} from "../../../src/eth1/index.js";
import {Eth1Options} from "../../../src/eth1/options.js";
import {getTestnetConfig, medallaTestnetConfig} from "../../utils/testnet.js";
import {testLogger} from "../../utils/logger.js";
import {BeaconDb} from "../../../src/db/index.js";
import {generateState} from "../../utils/state.js";
import {Eth1Provider} from "../../../src/eth1/provider/eth1Provider.js";
import {getGoerliRpcUrl} from "../../testParams.js";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";

const dbLocation = "./.__testdb";

// First Pyrmont deposits deposit_data_root field
const pyrmontDepositsDataRoot = [
  // https://goerli.etherscan.io/tx/0x342d3551439a13555c62f95d27b2fbabc816e4c23a6e58c28e69af6fae6d0159
  "0x8976a7deec59f3ebcdcbd67f512fdd07a9a7cab72b63e85bc7a22bb689c2a40c",
  // https://goerli.etherscan.io/tx/0x6bab2263e1801ae3ffd14a31c08602c17f0e105e8ab849855adbd661d8b87bfd
  "0x61cef7d8a3f7c590a2dc066ae1c95def5ce769b3e9471fdb34f36f7a7246965e",
];

describe.skip("eth1 / Eth1Provider", function () {
  this.timeout("2 min");

  const controller = new AbortController();

  const config = getTestnetConfig();
  const logger = testLogger();

  let db: BeaconDb;
  let dbController: LevelDbController;
  let interval: NodeJS.Timeout;

  before(async () => {
    // Nuke DB to make sure it's empty
    await promisify<string>(leveldown.destroy)(dbLocation);

    dbController = new LevelDbController({name: dbLocation}, {logger});
    db = new BeaconDb({
      config,
      controller: dbController,
    });

    await db.start();
  });

  after(async () => {
    clearInterval(interval);
    controller.abort();
    await db.stop();
    await promisify<string>(leveldown.destroy)(dbLocation);
  });

  it("Should fetch real Pyrmont eth1 data for block proposing", async function () {
    const eth1Options: Eth1Options = {
      enabled: true,
      providerUrls: [getGoerliRpcUrl()],
      depositContractDeployBlock: medallaTestnetConfig.depositBlock,
      unsafeAllowDepositDataOverwrite: false,
    };
    const eth1Provider = new Eth1Provider(config, eth1Options, controller.signal);

    const eth1ForBlockProduction = new Eth1ForBlockProduction(eth1Options, {
      config,
      db,
      metrics: null,
      logger,
      signal: controller.signal,
      eth1Provider,
    });

    // Resolves when Eth1ForBlockProduction has fetched both blocks and deposits
    const {eth1Datas, deposits} = await (async function resolveWithEth1DataAndDeposits() {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const eth1Datas = await db.eth1Data.entries();
        const deposits = await db.depositEvent.values();
        if (eth1Datas.length > 0 && deposits.length > 0) {
          return {eth1Datas, deposits};
        }
        await sleep(1000, controller.signal);
      }
    })();

    // Generate mock state to query eth1 data for block proposing
    if (eth1Datas.length === 0) throw Error("No eth1Datas");
    const {key: maxTimestamp, value: latestEth1Data} = eth1Datas[eth1Datas.length - 1];

    const {SECONDS_PER_ETH1_BLOCK, ETH1_FOLLOW_DISTANCE} = config;
    // block.timestamp + SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE <= period_start && ...
    const periodStart = maxTimestamp + SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE;

    // Compute correct deposit root tree
    const depositRootTree = ssz.phase0.DepositDataRootList.toViewDU(
      pyrmontDepositsDataRoot.map((root) => fromHexString(root))
    );

    const tbState = generateState(
      {
        // Set genesis time and slot so latestEth1Data is considered
        slot: 0,
        genesisTime: periodStart,
        // No deposits processed yet
        // eth1_deposit_index represents the next deposit index to be added
        eth1DepositIndex: 0,
        // Set eth1Data with deposit length to return them
        eth1Data: {
          depositCount: deposits.length,
          depositRoot: depositRootTree.hashTreeRoot(),
          blockHash: Buffer.alloc(32),
        },
      },
      config
    );

    const state = createCachedBeaconStateTest(tbState, config);

    const result = await eth1ForBlockProduction.getEth1DataAndDeposits(state);
    expect(result.eth1Data).to.deep.equal(latestEth1Data, "Wrong eth1Data for block production");
    expect(
      result.deposits.map((deposit) => toHexString(ssz.phase0.DepositData.hashTreeRoot(deposit.data)))
    ).to.deep.equal(pyrmontDepositsDataRoot, "Wrong deposits for for block production");
  });
});
