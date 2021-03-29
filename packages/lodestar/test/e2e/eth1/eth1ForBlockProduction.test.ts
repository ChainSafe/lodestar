/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import "mocha";
import {expect} from "chai";
import {promisify} from "es6-promisify";
// @ts-ignore
import leveldown from "leveldown";
import {AbortController} from "abort-controller";
import {sleep} from "@chainsafe/lodestar-utils";
import {LevelDbController} from "@chainsafe/lodestar-db";

import {Eth1ForBlockProduction, Eth1Provider} from "../../../src/eth1";
import {IEth1Options} from "../../../src/eth1/options";
import {getTestnetConfig, testnet} from "../../utils/testnet";
import {testLogger} from "../../utils/logger";
import {BeaconDb} from "../../../src/db";
import {generateState} from "../../utils/state";
import {fromHexString, List, toHexString} from "@chainsafe/ssz";
import {Root} from "@chainsafe/lodestar-types";
import {createCachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";

const dbLocation = "./.__testdb";

// First Pyrmont deposits deposit_data_root field
const pyrmontDepositsDataRoot = [
  // https://goerli.etherscan.io/tx/0x342d3551439a13555c62f95d27b2fbabc816e4c23a6e58c28e69af6fae6d0159
  "0x8976a7deec59f3ebcdcbd67f512fdd07a9a7cab72b63e85bc7a22bb689c2a40c",
  // https://goerli.etherscan.io/tx/0x6bab2263e1801ae3ffd14a31c08602c17f0e105e8ab849855adbd661d8b87bfd
  "0x61cef7d8a3f7c590a2dc066ae1c95def5ce769b3e9471fdb34f36f7a7246965e",
];

describe("eth1 / Eth1Provider", function () {
  this.timeout("2 min");

  const eth1Options: IEth1Options = {
    enabled: true,
    providerUrl: testnet.providerUrl,
    depositContractDeployBlock: testnet.depositBlock,
  };
  const controller = new AbortController();

  const config = getTestnetConfig();
  const logger = testLogger();
  const eth1Provider = new Eth1Provider(config, eth1Options);

  let db: BeaconDb;
  let dbController: LevelDbController;
  let interval: NodeJS.Timeout;

  before(async () => {
    // Nuke DB to make sure it's empty
    await promisify<void, string>(leveldown.destroy)(dbLocation);

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
    await promisify<void, string>(leveldown.destroy)(dbLocation);
  });

  it("Should fetch real Pyrmont eth1 data for block proposing", async function () {
    const eth1ForBlockProduction = new Eth1ForBlockProduction({
      config,
      db,
      eth1Provider,
      logger,
      opts: eth1Options,
      signal: controller.signal,
    });

    // Resolves when Eth1ForBlockProduction has fetched both blocks and deposits
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
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

    const {SECONDS_PER_ETH1_BLOCK, ETH1_FOLLOW_DISTANCE} = config.params;
    // block.timestamp + SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE <= period_start && ...
    const periodStart = maxTimestamp + SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE;

    // Compute correct deposit root tree
    const depositRootTree = config.types.phase0.DepositDataRootList.createTreeBackedFromStruct(
      pyrmontDepositsDataRoot.map((root) => fromHexString(root)) as List<Root>
    );

    const state = createCachedBeaconState(
      config,
      generateState(
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
      )
    );

    const result = await eth1ForBlockProduction.getEth1DataAndDeposits(state);
    expect(result.eth1Data).to.deep.equal(latestEth1Data, "Wrong eth1Data for block production");
    expect(
      result.deposits.map((deposit) => toHexString(config.types.phase0.DepositData.hashTreeRoot(deposit.data)))
    ).to.deep.equal(pyrmontDepositsDataRoot, "Wrong deposits for for block production");
  });
});
