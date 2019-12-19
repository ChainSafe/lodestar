import {expect} from "chai";
import rimraf from "rimraf";

import {config as minimalConfig} from "@chainsafe/eth2.0-config/lib/presets/minimal";

import { ILogger, WinstonLogger } from "../../../../src/logger";
import { BeaconNode } from "../../../../src/node";
import { InteropEth1Notifier } from "../../../../src/eth1/impl/interop";
import { createPeerId } from "../../../../src/network";
import { createNodeJsLibp2p } from "../../../../src/network/nodejs";
import { quickStartState } from "../../../../src/interop/state";
import { ProgressiveMerkleTree } from "@chainsafe/eth2.0-utils";
import { MerkleTreeSerialization } from "../../../../src/util/serialization";
import { computeStartSlotAtEpoch, computeEpochAtSlot, getCurrentSlot } from "@chainsafe/eth2.0-state-transition";
import { existsSync, mkdirSync } from "fs";
import {ApiClientOverInstance} from "@chainsafe/lodestar-validator/lib/api";
import { Keypair, PrivateKey } from "@chainsafe/bls";
import { interopKeypair } from "../../../../src/interop/keypairs";
import { ValidatorClient } from "../../../../src/validator/nodejs";
import { ValidatorApi, BeaconApi } from "../../../../src/api/rpc";
import { DEPOSIT_CONTRACT_TREE_DEPTH } from "../../../../src/constants";


const VALIDATOR_COUNT = 5;
const SECONDS_PER_SLOT = 2;
const SLOTS_PER_EPOCH = 5;
const VALIDATOR_DIR = "./validators";
const LODESTAR_DIR = "lodestar-db";

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe("e2e interop simulation", function() {
  this.timeout(100000);
  let logger: ILogger = new WinstonLogger();
  //logger.silent = true;
  let node: BeaconNode;
  let validators: ValidatorClient[];

  before(async () => {
    rimraf.sync(VALIDATOR_DIR);
    rimraf.sync(LODESTAR_DIR);
    validators = [];
  });

  after(async () => {
    await Promise.all(validators.map(validator => validator.stop()));
    logger.info("Stopped all validators");
    await node.stop();
    logger.info("Stopped Beacon Node");
    rimraf.sync(VALIDATOR_DIR);
    rimraf.sync(LODESTAR_DIR);
  });

  
  it("should be able to run until a justified epoch with minimal config", async () => {
    await initializeNode();
    logger.info("Node is initialized");
    await startValidators();
    logger.info("Validators are started");

    let hasReceivedEvent = false;
    node.chain.on("justifiedCheckpoint", () => {
      hasReceivedEvent = true;
      logger.info("Received justifiedCheckpoint event");
    });
    // wait for 60 seconds at most, check every second
    for (let i = 0; i < 60; i++) {
      if(hasReceivedEvent) break;
      await sleep(1000);
    }
    if(!hasReceivedEvent) expect.fail("Not received justifiedCheckpoint event");
  });

  async function initializeNode() {
    // BeaconNode has default config
    const conf = {};
    minimalConfig.params.SECONDS_PER_SLOT = SECONDS_PER_SLOT;
    minimalConfig.params.SLOTS_PER_EPOCH = SLOTS_PER_EPOCH;
    const peerId = createPeerId();
    const libp2p = await createNodeJsLibp2p(peerId, {});
    node = new BeaconNode(conf, {config: minimalConfig, logger, eth1: new InteropEth1Notifier(), libp2p});

    const genesisTime = Math.round(Date.now()/1000);
    const tree = ProgressiveMerkleTree.empty(DEPOSIT_CONTRACT_TREE_DEPTH, new MerkleTreeSerialization(minimalConfig));
    let state = quickStartState(minimalConfig, tree, genesisTime, VALIDATOR_COUNT);
    await node.chain.initializeBeaconChain(state, tree);
    const targetSlot = computeStartSlotAtEpoch(
      minimalConfig,
      computeEpochAtSlot(minimalConfig, getCurrentSlot(minimalConfig, state.genesisTime))
    );
    await node.chain.advanceState(targetSlot);
    await node.start();
  }

  async function startValidators(): Promise<void> {
    if(!existsSync(VALIDATOR_DIR)) {
      mkdirSync(VALIDATOR_DIR);
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
      opPool: node.opPool,
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
    const validator = new ValidatorClient(
      {
        validatorKey: keypair.privateKey.toHexString(),
        restApi: rpcInstance,
        db: VALIDATOR_DIR + "/validator-db-" + index,
        config: node.config
      },
      {
        logger
      }
    );
    validators.push(validator);
    validator.start();
  }
});
