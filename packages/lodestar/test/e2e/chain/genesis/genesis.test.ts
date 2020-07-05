import {IEth1Notifier, EthersEth1Notifier} from "../../../../src/eth1";
import {IEth1Options} from "../../../../src/eth1/options";
import {BeaconDb, LevelDbController} from "../../../../src/db";
import {ILogger, WinstonLogger, LogLevel} from "@chainsafe/lodestar-utils";
import {ethers} from "ethers";
import defaults from "../../../../src/eth1/dev/options";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import * as fs from "fs";
import {expect} from "chai";
import {toHexString, fromHexString} from "@chainsafe/ssz";
import sinon from "sinon";
import {GenesisBuilder} from "../../../../src/chain/genesis/genesis";
import {computeForkDigest} from "@chainsafe/lodestar-beacon-state-transition";
import {sleep} from "../../../../src/util/sleep";

describe("BeaconChain", function() {
  this.timeout(10 * 60 * 1000);

  let eth1Notifier: IEth1Notifier;
  let provider: ethers.providers.JsonRpcProvider;
  let builder: GenesisBuilder;
  const opts: IEth1Options = {
    ...defaults,
    provider: {
      url: "https://goerli.prylabs.net",
      network: 5,
    },
    depositContract: {
      ...defaults.depositContract,
      deployedAt: 2917810,
      address: "0x16e82D77882A663454Ef92806b7DeCa1D394810f",
    }
  };
  let db: BeaconDb;
  const dbPath = "./.tmpdb";
  const logger: ILogger = new WinstonLogger();
  logger.silent = false;
  logger.level = LogLevel.info;
  const altonaConfig = Object.assign({}, {params: config.params}, config);
  altonaConfig.params = Object.assign({}, config.params, {
    MIN_GENESIS_TIME: 1593433800,
    MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 640,
    GENESIS_DELAY: 172800,
    GENESIS_FORK_VERSION: fromHexString("0x00000121")
  });


  const sandbox = sinon.createSandbox();

  before(async () => {
    await fs.promises.rmdir(dbPath, {recursive: true});
    expect(altonaConfig.params.MIN_GENESIS_TIME).to.be.not.equal(config.params.MIN_GENESIS_TIME);
    expect(altonaConfig.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT).to.be.not.equal(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT);
    db = new BeaconDb({
      config: altonaConfig,
      controller: new LevelDbController({name: dbPath}, {logger}),
    });
    provider = new ethers.providers.JsonRpcProvider(opts.provider.url, opts.provider.network);
    await db.start();
    eth1Notifier = new EthersEth1Notifier(
      {...opts, providerInstance: provider},
      {
        config: altonaConfig,
        db,
        logger: logger.child({module: "eth1"}),
      });
  });


  beforeEach(async function () {
    builder = new GenesisBuilder(altonaConfig, {eth1: eth1Notifier, db, logger: logger.child({module: "genesis"})});
  });

  afterEach(async () => {
    sandbox.restore();
  });

  after(async () => {
    await db.stop();
    await fs.promises.rmdir(dbPath, {recursive: true});
  });

  it("should detect altona genesis state", async function() {
    logger.profile("detect altona genesis state");
    const headState = await builder.waitForGenesis();
    // https://github.com/goerli/altona/tree/master/altona
    expect(toHexString(altonaConfig.types.BeaconState.hashTreeRoot(headState))).to.be.equal("0x939d98077986a9f6eccae33614e2da1008a2f300f1aac36bc65ef710550eec4a");
    expect(headState.genesisTime).to.be.equal(1593433805);
    const forkDigest = computeForkDigest(altonaConfig, headState.fork.currentVersion, headState.genesisValidatorsRoot);
    expect(toHexString(forkDigest)).to.be.equal("0xfdca39b0");
    logger.profile("detect altona genesis state");
    await eth1Notifier.stop();
    await sleep(200);
  });
});