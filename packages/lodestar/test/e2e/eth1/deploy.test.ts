import * as fs from "fs";
import {expect} from "chai";
import {ethers} from "ethers";
import sinon from "sinon";
import {describe, it, beforeEach, afterEach} from "mocha";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {EthersEth1Notifier, IEth1Notifier} from "../../../src/eth1";
import defaults from "../../../src/eth1/dev/options";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {BeaconDb, LevelDbController} from "../../../src/db";
import {IEth1Options} from "../../../src/eth1/options";

describe("Eth1Notifier - using goerli known deployed contract", () => {

  let eth1Notifier: IEth1Notifier;
  let provider: ethers.providers.JsonRpcProvider;
  // Use topaz deposit contract
  // start 1 block before first deposit
  const opts: IEth1Options = {
    ...defaults,
    provider: {
      url: "https://goerli.prylabs.net",
      network: 5,
    },
    depositContract: {
      ...defaults.depositContract,
      deployedAt: 2524641,
      address: "0x5cA1e00004366Ac85f492887AAab12d0e6418876",
    }
  };
  let db: BeaconDb;
  const dbPath = "./.tmpdb";
  const logger: ILogger = new WinstonLogger();

  beforeEach(async function () {
    this.timeout(0);
    logger.silent = true;
    db = new BeaconDb({
      config,
      controller: new LevelDbController({name: dbPath}, {logger}),
    });
    provider = new ethers.providers.JsonRpcProvider(opts.provider.url, opts.provider.network);
    eth1Notifier = new EthersEth1Notifier(
      {...opts, providerInstance: provider},
      {
        config,
        db,
        logger,
      });
    await db.start();
  });

  afterEach(async () => {
    await eth1Notifier.stop();
    await db.stop();
    await fs.promises.rmdir(dbPath, {recursive: true});
    logger.silent = false;
  });

  it("should process blocks", async function () {
    this.timeout(0);
    // process 10 blocks, starting from depositContract.deployedAt
    // there should be two deposits to process
    provider.getBlockNumber = sinon.stub().resolves(opts.depositContract.deployedAt + config.params.ETH1_FOLLOW_DISTANCE + 10);
    await eth1Notifier.start();
    await new Promise(resolve => setTimeout(resolve, 9000));
    const tree = await db.depositDataRoot.getTreeBacked(1);
    expect(tree.length).to.be.equal(2);
  });

  it("should resume processing blocks after restart", async function () {
    this.timeout(0);
    // process 3 blocks, starting from depositContract.deployedAt
    // there should be one deposit to process
    provider.getBlockNumber = sinon.stub().resolves(opts.depositContract.deployedAt + config.params.ETH1_FOLLOW_DISTANCE + 3);
    await eth1Notifier.start();
    await new Promise(resolve => setTimeout(resolve, 4000));
    await eth1Notifier.stop();
    const tree = await db.depositDataRoot.getTreeBacked(0);
    expect(tree.length).to.be.equal(1);

    // process 7 more blocks, it should start from where it left off
    provider.getBlockNumber = sinon.stub().resolves(opts.depositContract.deployedAt + config.params.ETH1_FOLLOW_DISTANCE + 10);
    await eth1Notifier.start();
    await new Promise(resolve => setTimeout(resolve, 5000));
    const tree2 = await db.depositDataRoot.getTreeBacked(1);
    expect(tree2.length).to.be.equal(2);
  });

});
