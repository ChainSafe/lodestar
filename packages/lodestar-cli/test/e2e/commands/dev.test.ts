import rimraf from "rimraf";
import {ENR} from "@chainsafe/discv5";
import {config as minimalConfig} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {InteropEth1Notifier} from "@chainsafe/lodestar/lib/eth1/impl/interop";
import {createPeerId} from "@chainsafe/lodestar/lib/network";
import {createNodeJsLibp2p} from "@chainsafe/lodestar/lib/network/nodejs";
import {existsSync, mkdirSync} from "fs";
import {ApiClientOverInstance} from "@chainsafe/lodestar-validator/lib/api";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {Validator} from "@chainsafe/lodestar-validator";
import {join} from "path";
import {BeaconApi, ValidatorApi} from "@chainsafe/lodestar/lib/api/impl";
import {expect} from "chai";
import {BlockSummary} from "@chainsafe/lodestar/lib/chain";
import {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState} from "@chainsafe/lodestar-types";
import {interopDeposits} from "../../../src/lodecli/cmds/dev/utils/interop/deposits";
import {getInteropState} from "../../../src/lodecli/cmds/dev/utils/interop/state";
import {interopKeypair} from "@chainsafe/lodestar-validator/lib";
import {LevelDbController, ValidatorDB} from "@chainsafe/lodestar/lib/db";

const VALIDATOR_COUNT = 5;
const SECONDS_PER_SLOT = 2;
const SLOTS_PER_EPOCH = 5;
const VALIDATOR_DIR = ".tmp/test/validators";
const LODESTAR_DIR = ".tmp/test/lodestar-db";

describe("e2e interop simulation", function() {
  this.timeout(100000);
  const logger: ILogger = new WinstonLogger();
  logger.silent = true;
  // logger.level = LogLevel.debug;
  let node: BeaconNode;
  let validators: Validator[];
  let head: BlockSummary;
  let cachedStates: BeaconState[];
  let blockSummaries: BlockSummary[];
  const conf = {
    db: {name: LODESTAR_DIR}
  };
  // don't want to affect other tests
  const devConfig = Object.assign({}, {params: minimalConfig.params}, minimalConfig);
  devConfig.params = Object.assign({}, minimalConfig.params, {SECONDS_PER_SLOT, SLOTS_PER_EPOCH});

  before(() => {
    rimraf.sync(VALIDATOR_DIR);
    rimraf.sync(LODESTAR_DIR);
  });

  beforeEach(async () => {
    validators = [];
  });

  afterEach(async () => {
    const promises = validators.map((validator: Validator) => validator.stop());
    await Promise.all(promises);
    logger.info("Stopped all validators");
    await new Promise(resolve => setTimeout(resolve, SECONDS_PER_SLOT * 1000));
    await node.stop();
    logger.info("Stopped Beacon Node");
  });

  after(() => {
    rimraf.sync(VALIDATOR_DIR);
    rimraf.sync(LODESTAR_DIR);
  });

  it("should be able to run until a justified epoch with minimal config", async () => {
    await initializeNode();
    logger.info("Node is initialized");
    await startValidators();
    logger.info("Validators are started");

    // wait for 60 seconds at most
    const received = new Promise((resolve, reject) => {
      const timer = setTimeout(reject, 60000);
      node.chain.on("justifiedCheckpoint", () => {
        logger.info("Received justifiedCheckpoint event");
        clearTimeout(timer);
        resolve();
      });
    });
    await received;
    // data for next test
    cachedStates = (await node.db.stateCache.values()).sort((a, b) => a.slot - b.slot);
    const forkChoice = node.chain.forkChoice;
    blockSummaries = cachedStates.map(state => forkChoice.getBlockSummaryAtSlot(state.slot));
    head = forkChoice.head();
  });


  it("should restore chain state upon start", async () => {
    node = await getBeaconNode(conf, devConfig);
    expect((await node.db.stateCache.values()).length).to.be.equal(0);
    await node.start();

    // Same state cache
    const newCachedStates = (await node.db.stateCache.values()).sort((a, b) => a.slot - b.slot);
    expect(cachedStates.length).to.be.equal(newCachedStates.length);
    cachedStates.forEach((state, index) => {
      expect(devConfig.types.BeaconState.equals(state, newCachedStates[index]));
    });
    const forkChoice = node.chain.forkChoice;
    const newBlockSummaries = newCachedStates.map(state => forkChoice.getBlockSummaryAtSlot(state.slot));
    // Forkchoice: Same block summaries
    blockSummaries.forEach((blockSummary, index) => {
      expect(blockSummary).to.be.deep.equal(newBlockSummaries[index]);
    });
    // Forkchoice: same head
    expect(node.chain.forkChoice.head()).to.be.deep.equal(head);
  });

  async function initializeNode(): Promise<void> {
    // BeaconNode has default config
    mkdirSync(LODESTAR_DIR, {recursive: true});

    expect(devConfig.params.SECONDS_PER_SLOT).to.be.lt(minimalConfig.params.SECONDS_PER_SLOT);
    node = await getBeaconNode(conf, devConfig);

    const genesisTime = Math.floor(Date.now()/1000);
    const depositDataRootList = devConfig.types.DepositDataRootList.tree.defaultValue();
    const deposits = interopDeposits(
      devConfig,
      devConfig.types.DepositDataRootList.tree.defaultValue(),
      VALIDATOR_COUNT
    );
    for (let i = 0; i < deposits.length; i++) {
      await Promise.all([
        node.db.depositData.put(i, deposits[i].data),
        node.db.depositDataRoot.put(i, devConfig.types.DepositData.hashTreeRoot(deposits[i].data)),
      ]);
    }
    const state = getInteropState(devConfig, depositDataRootList, genesisTime, deposits);
    await node.chain.initializeBeaconChain(state);
    await node.start();
  }

  async function getBeaconNode(conf: Partial<IBeaconNodeOptions>, devConfig: IBeaconConfig): Promise<BeaconNode> {
    const peerId = await createPeerId();
    const libp2p = await createNodeJsLibp2p(
      peerId,
      {
        maxPeers: 0,
        discv5: {
          enr: ENR.createFromPeerId(peerId),
          bindAddr: "/ip4/127.0.0.1/udp/0", bootEnrs: []
        }
      }, false
    );
    return new BeaconNode(conf, {config: devConfig, logger, eth1: new InteropEth1Notifier(), libp2p});
  }

  async function startValidators(): Promise<void> {
    if(!existsSync(VALIDATOR_DIR)) {
      mkdirSync(VALIDATOR_DIR, {recursive: true});
    }
    for(let i = 0; i < VALIDATOR_COUNT; i++) {
      startValidator(interopKeypair(i).privkey, node);
    }
  }

  async function startValidator(privkey: Buffer, node: BeaconNode): Promise<void> {
    const modules = {
      config: node.config,
      sync: node.sync,
      eth1: node.eth1,
      network: node.network,
      logger: new WinstonLogger({module: "API"}),
      chain: node.chain,
      db: node.db
    };
    modules.logger.silent = true;
    const rpcInstance = new ApiClientOverInstance({
      config: node.config,
      validator: new ValidatorApi({}, modules),
      beacon: new BeaconApi({}, modules),
    });
    const keypair = new Keypair(PrivateKey.fromBytes(privkey));
    const index = await node.db.getValidatorIndex(keypair.publicKey.toBytesCompressed());
    const validatorLogger =new WinstonLogger({module: `Validator #${index}`});
    validatorLogger.silent = true;
    const validator = new Validator(
      {
        keypair,
        api: rpcInstance,
        logger,
        db: new ValidatorDB({
          config: node.config,
          controller: new LevelDbController({
            name: join(VALIDATOR_DIR, "validator-db-" + index)
          }, {logger})
        }),
        config: node.config
      },
    );
    validators.push(validator);
    await validator.start();
  }
});
