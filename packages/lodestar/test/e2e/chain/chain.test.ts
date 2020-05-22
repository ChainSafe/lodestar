import {IEth1Notifier, EthersEth1Notifier} from "../../../src/eth1";
import {IEth1Options} from "../../../src/eth1/options";
import {BeaconDb, LevelDbController} from "../../../src/db";
import {ILogger, WinstonLogger, LogLevel} from "@chainsafe/lodestar-utils";
import {ethers} from "ethers";
import defaults from "../../../src/eth1/dev/options";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import * as fs from "fs";
import {BeaconChain} from "../../../src/chain";
import chainOpts from "../../../src/chain/options";
import {BeaconMetrics} from "../../../src/metrics";
import {expect, assert} from "chai";
import {toHexString} from "@chainsafe/ssz";
import {WatchEth1ForProposingTask} from "../../../src/tasks/tasks/watchEth1ForProposingTask";
import {BeaconSync} from "../../../src/sync";
import sinon from "sinon";
import {sleep} from "../../../src/util/sleep";

describe("BeaconChain", () => {

  let eth1Notifier: IEth1Notifier;
  let chain: BeaconChain;
  let provider: ethers.providers.JsonRpcProvider;
  let metrics: any;
  let sync: any;
  const opts: IEth1Options = {
    ...defaults,
    provider: {
      url: "https://goerli.prylabs.net",
      network: 5,
    },
    depositContract: {
      ...defaults.depositContract,
      deployedAt: 2596126,
      address: "0xA15554BF93a052669B511ae29EA21f3581677ac5",
    }
  };
  let db: BeaconDb;
  const dbPath = "./.tmpdb";
  const logger: ILogger = new WinstonLogger();
  logger.silent = true;
  // logger.level = LogLevel.verbose;
  const schlesiConfig = Object.assign({}, {params: config.params}, config);
  schlesiConfig.params = Object.assign({}, config.params, {MIN_GENESIS_TIME: 1587755000, MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 4});
  const sandbox = sinon.createSandbox();

  before(async () => {
    await fs.promises.rmdir(dbPath, {recursive: true});
    expect(schlesiConfig.params.MIN_GENESIS_TIME).to.be.not.equal(config.params.MIN_GENESIS_TIME);
    expect(schlesiConfig.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT).to.be.not.equal(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT);
    db = new BeaconDb({
      config: schlesiConfig,
      controller: new LevelDbController({name: dbPath}, {logger}),
    });
    provider = new ethers.providers.JsonRpcProvider(opts.provider.url, opts.provider.network);
    await db.start();
    eth1Notifier = new EthersEth1Notifier(
      {...opts, providerInstance: provider},
      {
        config: schlesiConfig,
        logger,
      });
    await eth1Notifier.start();
  });


  beforeEach(async function () {
    sync = sandbox.createStubInstance(BeaconSync);

    metrics = new BeaconMetrics({enabled: false} as any, {logger});
    chain = new BeaconChain(chainOpts, {config: schlesiConfig, db, eth1: eth1Notifier, logger, metrics});
  });

  afterEach(async () => {
    sandbox.restore();
  });

  after(async () => {
    await db.stop();
    await eth1Notifier.stop();
    await fs.promises.rmdir(dbPath, {recursive: true});
  });

  it("should detect schlesi genesis state", async function() {
    this.timeout(20000);
    await eth1Notifier.start();
    const start = Date.now();
    await chain.start();
    const headState = await chain.getHeadState();
    const eth1Data = headState.eth1Data;
    // https://schlesi.beaconcha.in/block/1
    expect(toHexString(eth1Data.blockHash)).to.be.equal("0x54b9f905f15634d966690bd362381cfd7a28362d683f8d1616aa478b575152f8");
    expect(toHexString(eth1Data.depositRoot)).to.be.equal("0x24dccd5595a434f57680128048c69548919b067b1285693d06881f6101325d1d");
    expect(eth1Data.depositCount).to.be.equal(4);
    const forkDigest = await chain.currentForkDigest;
    // schlesi fork digest: https://github.com/goerli/schlesi
    expect(toHexString(forkDigest)).to.be.equal("0x9925efd6");
    logger.info(`chain is started successfully. Genesis state found in ${Math.floor(Date.now() - start) / 1000} seconds`);
    await chain.stop();
    logger.info("chain stopped");
  });

  /**
   * this test has to start immediately after the above test.
   */
  it("should start WatchEth1ForProposingTask and store proposing data successfully", async function() {
    this.timeout(100000);
    const lastProcessedEth1Block = await db.getLastProcessedEth1BlockNumber();
    logger.info(`At genesis, lastProcessedEth1Block=${lastProcessedEth1Block}`);
    // eth1 block at genesis
    expect(lastProcessedEth1Block).to.be.equal(2596296);
    const watchEth1Task = new WatchEth1ForProposingTask(schlesiConfig, {
      db,
      eth1: eth1Notifier,
      logger,
      sync
    });
    watchEth1Task.finishInitSync();
    await watchEth1Task.start();
    try {
      // wait for proposing data
      let eth1DataCount = (await db.eth1Data.values()).length;
      // from genesis
      expect(eth1DataCount).to.be.equal(1);
      await new Promise((resolve, reject) => {
        const rejectTimer = setTimeout(reject, 10000);
        (
          async () => {
            while (eth1DataCount < 2) {
              eth1DataCount = (await db.eth1Data.values()).length;
              sleep(500);
            }
            clearTimeout(rejectTimer);
            resolve();
          }
        )();
      });
      logger.info(`Found ${eth1DataCount} eth1Data`);
      const depositDatas = await db.depositData.values();
      expect(depositDatas.length).to.be.greaterThan(0);
      logger.info(`Found ${depositDatas.length} depositData`);
    } catch (err) {
      assert(false, "Failed with error " + err);
    } finally {
      await watchEth1Task.stop();
      // wait for any database operation
      await sleep(1000);
      logger.info("WatchEth1ForProposingTask stopped");
    }
  });
});