import {expect} from "chai";
import {ethers} from "ethers";
import sinon from "sinon";
import {afterEach, beforeEach, describe, it} from "mocha";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {EthersEth1Notifier, IEth1Notifier, IDepositEvent, Eth1EventsBlock} from "../../../src/eth1";
import defaults from "../../../src/eth1/dev/options";
import {ILogger, LogLevel, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {BeaconDb, LevelDbController} from "../../../src/db";
import {IEth1Options} from "../../../src/eth1/options";
import rimraf from "rimraf";
import pipe from "it-pipe";

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
  // chain can't receive eth1Data that's not qualified genesis condition so we need this test config
  const testConfig = Object.assign({}, {params: config.params}, config);
  // 1586833385 is timestamp of the contract's block
  testConfig.params = Object.assign({}, config.params,
    {MIN_GENESIS_TIME: 1586833385, MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 1, ETH1_FOLLOW_DISTANCE: 0});
  beforeEach(async function () {
    this.timeout(0);
    rimraf.sync(dbPath);
    logger.silent = true;
    logger.level = LogLevel.verbose;
    db = new BeaconDb({
      config: testConfig,
      controller: new LevelDbController({name: dbPath}, {logger}),
    });
    provider = new ethers.providers.JsonRpcProvider(opts.provider.url, opts.provider.network);
    eth1Notifier = new EthersEth1Notifier(
      {...opts, providerInstance: provider},
      {
        config: testConfig,
        db,
        logger,
      });
    await db.start();
    await eth1Notifier.start();
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
    const targetBlockNumber = opts.depositContract.deployedAt + 1;
    provider.getBlockNumber = sinon.stub().resolves(targetBlockNumber);
    await waitForEth1Block(targetBlockNumber);
    const tree = await db.depositDataRoot.getTreeBacked(0);
    expect(tree.length).to.be.equal(1);
  });

  it("should resume processing blocks after restart", async function () {
    this.timeout(0);
    // process 3 blocks, starting from depositContract.deployedAt
    // there should be one deposit to process
    const target1BlockNumber = opts.depositContract.deployedAt + 3;
    provider.getBlockNumber = sinon.stub().resolves(target1BlockNumber);
    await waitForEth1Block(opts.depositContract.deployedAt + 1);
    await eth1Notifier.stop();
    const tree = await db.depositDataRoot.getTreeBacked(0);
    expect(tree.length).to.be.equal(1);
    const target2BlockNumber = opts.depositContract.deployedAt + 10;
    // process 7 more blocks, it should start from where it left off
    provider.getBlockNumber = sinon.stub().resolves(target2BlockNumber);
    await eth1Notifier.start();
    // await blockPromise2;
    await waitForEth1Block(opts.depositContract.deployedAt + 9);
    const tree2 = await db.depositDataRoot.getTreeBacked(1);
    expect(tree2.length).to.be.equal(2);
  });

  async function waitForEth1Block(targetBlockNumber: number): Promise<void> {
    const eth1DataStream = await eth1Notifier.getEth1BlockAndDepositEventsSource();
    await pipe(eth1DataStream, async function(source: AsyncIterable<Eth1EventsBlock>) {
      for await (const {block} of source) {
        if (block && block.number === targetBlockNumber) {
          return;
        }
      }
    });
    await eth1Notifier.endEth1BlockAndDepositEventsSource();
  }

});
