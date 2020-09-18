import "mocha";
import {expect} from "chai";
import {promisify} from "es6-promisify";
// @ts-ignore
import leveldown from "leveldown";
import {AbortController} from "abort-controller";
import {WinstonLogger, LogLevel} from "@chainsafe/lodestar-utils";

import {Eth1ForBlockProduction} from "../../../src/eth1";
import {IEth1Options} from "../../../src/eth1/options";
import {getMedallaConfig, medalla} from "./util";
import {BeaconDb, LevelDbController} from "../../../src/db";
import {sleep} from "../../../src/util/sleep";
import {generateState} from "../../utils/state";
import {toHexString} from "@chainsafe/ssz";

const dbLocation = "./.__testdb";

const firstMedallaDeposits = [
  // https://goerli.etherscan.io/tx/0x342d3551439a13555c62f95d27b2fbabc816e4c23a6e58c28e69af6fae6d0159
  "0xae9e6a550ac71490cdf134533b1688fcbdb16f113d7190eacf4f2e9ca6e013d5bd08c37cb2bde9bbdec8ffb8edbd495b",
  // https://goerli.etherscan.io/tx/0x6bab2263e1801ae3ffd14a31c08602c17f0e105e8ab849855adbd661d8b87bfd
  "0xb1d0ec8f907e023ea7b8cb1236be8a74d02ba3f13aba162da4a68e9ffa2e395134658d150ef884bcfaeecdf35c286496",
];

describe("eth1 / Eth1Provider", function () {
  this.timeout("2 min");

  const eth1Options: IEth1Options = {
    enabled: true,
    providerUrl: medalla.providerUrl,
    depositContractDeployBlock: medalla.depositBlock,
  };
  const controller = new AbortController();

  const config = getMedallaConfig();
  const logger = new WinstonLogger({level: LogLevel.verbose});

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

  it("Should fetch real Medalla eth1 data for block proposing", async function () {
    const eth1ForBlockProduction = new Eth1ForBlockProduction({
      config,
      db,
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

    const state = generateState({
      // Set genesis time and slot so latestEth1Data is considered
      slot: 0,
      genesisTime: periodStart,
      // No deposits processed yet
      // eth1_deposit_index represents the next deposit index to be added
      eth1DepositIndex: 0,
      // Set eth1Data with deposit length to return them
      eth1Data: {
        depositCount: deposits.length,
        depositRoot: Buffer.alloc(32),
        blockHash: Buffer.alloc(32),
      },
    });

    const result = await eth1ForBlockProduction.getEth1DataAndDeposits(state);
    expect(result.eth1Data).to.deep.equal(latestEth1Data, "Wrong eth1Data for block production");
    expect(result.deposits.map((deposit) => toHexString(deposit.data.pubkey))).to.deep.equal(
      firstMedallaDeposits,
      "Wrong deposits for for block production"
    );
  });
});
