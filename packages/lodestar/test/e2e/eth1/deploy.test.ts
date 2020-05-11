import * as fs from "fs";
import {expect} from "chai";
import {ethers} from "ethers";
import sinon from "sinon";
import {afterEach, beforeEach, describe, it} from "mocha";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {EthersEth1Notifier, IEth1Notifier} from "../../../src/eth1";
import defaults from "../../../src/eth1/dev/options";
import {ILogger, LogLevel, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {BeaconDb, LevelDbController} from "../../../src/db";
import {IEth1Options} from "../../../src/eth1/options";
import rimraf from "rimraf";

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
    rimraf.sync(dbPath);
    logger.silent = true;
    logger.level = LogLevel.verbose;
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
    rimraf.sync(dbPath);
    logger.silent = false;
  });

  it("should process blocks", async function () {
    this.timeout(0);
    // process 2 blocks, should be 1 deposit
    const targetBlockNumber = opts.depositContract.deployedAt + 2;
    provider.getBlockNumber = sinon.stub().resolves(targetBlockNumber);
    const blockPromise = new Promise(resolve => eth1Notifier.on("eth1Data", (_, __, blockNumber) => {
      if(blockNumber === targetBlockNumber) {
        eth1Notifier.removeAllListeners("eth1Data");
        resolve();
      }
    }));
    await eth1Notifier.start();
    await blockPromise;
    const tree = await db.depositDataRoot.getTreeBacked(0);
    expect(tree.length).to.be.equal(1);
  });

  it("should resume processing blocks after restart", async function () {
    this.timeout(0);
    // process 3 blocks, starting from depositContract.deployedAt
    // there should be one deposit to process
    const target1BlockNumber = opts.depositContract.deployedAt + 3;
    provider.getBlockNumber = sinon.stub().resolves(target1BlockNumber);
    const blockPromise1 = new Promise(resolve => eth1Notifier.on("eth1Data", (_, __, blockNumber) => {
      if(blockNumber === target1BlockNumber) {
        eth1Notifier.removeAllListeners("eth1Data");
        resolve();
      }
    }));
    await eth1Notifier.start();
    await blockPromise1;
    await eth1Notifier.stop();
    const tree = await db.depositDataRoot.getTreeBacked(0);
    expect(tree.length).to.be.equal(1);
    const target2BlockNumber = opts.depositContract.deployedAt + 10;
    // process 7 more blocks, it should start from where it left off
    provider.getBlockNumber = sinon.stub().resolves(target2BlockNumber);
    const blockPromise2 = new Promise(resolve => eth1Notifier.on("eth1Data", (_, __, blockNumber) => {
      if(blockNumber === target2BlockNumber) {
        eth1Notifier.removeAllListeners("eth1Data");
        resolve();
      }
    }));
    await eth1Notifier.start();
    await blockPromise2;
    const tree2 = await db.depositDataRoot.getTreeBacked(1);
    expect(tree2.length).to.be.equal(2);
  });

});
