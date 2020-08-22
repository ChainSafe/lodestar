import fs from "fs";
import {Eth1Provider} from "../../../../src/eth1";
import {BeaconDb, LevelDbController} from "../../../../src/db";
import {ILogger, WinstonLogger, LogLevel} from "@chainsafe/lodestar-utils";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {expect} from "chai";
import {toHexString, fromHexString} from "@chainsafe/ssz";
import {GenesisBuilder} from "../../../../src/chain/genesis/genesis";
import {computeForkDigest} from "@chainsafe/lodestar-beacon-state-transition";
import {sleep} from "../../../../src/util/sleep";

describe("BeaconChain", function () {
  this.timeout("10min");

  let db: BeaconDb;
  const dbPath = "./.tmpdb";
  const logger: ILogger = new WinstonLogger();
  logger.silent = false;
  logger.level = LogLevel.verbose;
  const altonaConfig = Object.assign({}, {params: config.params}, config);
  altonaConfig.params = Object.assign({}, config.params, {
    MIN_GENESIS_TIME: 1593433800,
    MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 640,
    GENESIS_DELAY: 172800,
    GENESIS_FORK_VERSION: fromHexString("0x00000121"),
    DEPOSIT_CHAIN_ID: 5,
    DEPOSIT_NETWORK_ID: 5,
    DEPOSIT_CONTRACT_ADDRESS: fromHexString("0x16e82D77882A663454Ef92806b7DeCa1D394810f"),
  });

  before(async () => {
    await fs.promises.rmdir(dbPath, {recursive: true});
    expect(altonaConfig.params.MIN_GENESIS_TIME).to.be.not.equal(config.params.MIN_GENESIS_TIME);
    expect(altonaConfig.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT).to.be.not.equal(
      config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT
    );
    db = new BeaconDb({
      config: altonaConfig,
      controller: new LevelDbController({name: dbPath}, {logger}),
    });
    await db.start();
  });

  after(async () => {
    await db.stop();
    await fs.promises.rmdir(dbPath, {recursive: true});
  });

  it("should detect altona genesis state", async function () {
    const eth1Provider = new Eth1Provider(altonaConfig, {
      enabled: true,
      providerUrl: "https://goerli.prylabs.net",
      depositContractDeployBlock: 2917810,
    });

    const builder = new GenesisBuilder(altonaConfig, {
      db,
      eth1Provider,
      logger: logger.child({module: "genesis"}),
    });

    logger.profile("detect altona genesis state");
    const headState = await builder.waitForGenesis();
    // https://github.com/goerli/altona/tree/master/altona
    expect(toHexString(altonaConfig.types.BeaconState.hashTreeRoot(headState))).to.be.equal(
      "0x939d98077986a9f6eccae33614e2da1008a2f300f1aac36bc65ef710550eec4a"
    );
    expect(headState.genesisTime).to.be.equal(1593433805);
    const forkDigest = computeForkDigest(altonaConfig, headState.fork.currentVersion, headState.genesisValidatorsRoot);
    expect(toHexString(forkDigest)).to.be.equal("0xfdca39b0");
    logger.profile("detect altona genesis state");
    await sleep(200);
  });
});
