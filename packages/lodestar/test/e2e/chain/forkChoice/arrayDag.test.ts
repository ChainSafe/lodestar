import {BeaconDb, LevelDbController} from "../../../../src/db";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {generateEmptySignedBlock} from "../../../utils/block";
import {generateState} from "../../../utils/state";
import {GENESIS_EPOCH} from "@chainsafe/lodestar-beacon-state-transition";
import crypto from "crypto";
import {expect} from "chai";
import {ArrayDagLMDGHOST, BeaconChain} from "../../../../src/chain";
import {LocalClock} from "../../../../src/chain/clock/local/LocalClock";
import fs from "fs";
import {InteropEth1Notifier} from "../../../../src/eth1/impl/interop";
import sinon from "sinon";
import {BeaconMetrics} from "../../../../src/metrics";
import chainOpts from "../../../../src/chain/options";

describe("forkChoice", function() {
  let db: BeaconDb;
  const dbPath = "./.tmpdb";
  const logger: ILogger = new WinstonLogger();
  logger.silent = true;
  let lmd: ArrayDagLMDGHOST;
  let chain: BeaconChain;

  beforeEach(async function () {
    db = new BeaconDb({
      config,
      controller: new LevelDbController({name: dbPath}, {logger}),
    });
    lmd = new ArrayDagLMDGHOST(config);
    // stub everytthing for chain except for db
    const eth1 = new InteropEth1Notifier();
    const metrics = sinon.createStubInstance(BeaconMetrics);
    chain = new BeaconChain(chainOpts, {config, db, eth1, logger, metrics, forkChoice: lmd});
  });

  afterEach(async () => {
    await db.stop();
    fs.rmdirSync(dbPath, {recursive: true});
    sinon.restore();
  });

  /**
   * A(0) -- B(1) -- C(2)
   */
  it.skip("should build indices upon start", async () => {
    // setup data
    const stateRootA = crypto.randomBytes(32);
    const blockA = generateEmptySignedBlock();
    blockA.message.stateRoot = stateRootA;
    const blockARoot = config.types.BeaconBlock.hashTreeRoot(blockA.message);
    await db.block.put(blockARoot, blockA);
    const stateA = generateState();
    stateA.slot = blockA.message.slot;
    stateA.currentJustifiedCheckpoint = {
      epoch: GENESIS_EPOCH,
      root: blockARoot,
    };
    stateA.finalizedCheckpoint = {
      epoch: GENESIS_EPOCH,
      root: blockARoot,
    };
    // await db.state.put(stateRootA, stateA);
    const blockB = generateEmptySignedBlock();
    blockB.message.slot = blockA.message.slot + 1;
    blockB.message.parentRoot = blockARoot;
    const stateRootB = crypto.randomBytes(32);
    blockB.message.stateRoot = stateRootB;
    const blockBRoot = config.types.BeaconBlock.hashTreeRoot(blockB.message);
    await db.block.put(blockBRoot, blockB);
    const stateB = generateState();
    stateB.slot = blockB.message.slot;
    stateB.currentJustifiedCheckpoint = {
      epoch: GENESIS_EPOCH,
      root: blockARoot,
    };
    stateB.finalizedCheckpoint = {
      epoch: GENESIS_EPOCH,
      root: blockARoot,
    };
    // await db.state.put(stateRootB, stateB);
    const blockC = generateEmptySignedBlock();
    blockC.message.slot = blockB.message.slot + 1;
    blockC.message.parentRoot = blockBRoot;
    const stateRootC = crypto.randomBytes(32);
    blockC.message.stateRoot = stateRootC;
    const blockCRoot = config.types.BeaconBlock.hashTreeRoot(blockC.message);
    await db.block.put(blockCRoot, blockC);
    const stateC = generateState();
    stateC.slot = blockC.message.slot;
    stateC.currentJustifiedCheckpoint = {
      epoch: GENESIS_EPOCH,
      root: blockARoot,
    };
    stateC.finalizedCheckpoint = {
      epoch: GENESIS_EPOCH,
      root: blockARoot,
    };
    // await db.state.put(stateRootC, stateC);

    // test
    const genesisTime = Math.floor(Date.now() / 1000);
    // await chain.restoreForkChoice();
    await lmd.start(genesisTime, new LocalClock(config, genesisTime));

    // confirm
    const nodeA = lmd.getNode(blockARoot);
    expect(nodeA.hasParent()).to.be.false;
    expect(nodeA.bestChild).to.be.equal(1);// BlockB
    expect(nodeA.bestTarget).to.be.equal(2);// BlockC
    expect(Object.values(nodeA.children)).to.be.deep.equal([1]);
    const nodeB = lmd.getNode(blockBRoot);
    expect(nodeB.parent).to.be.equal(0);// BlockA
    expect(nodeB.bestChild).to.be.equal(2);// BlockC
    expect(nodeB.bestTarget).to.be.equal(2);// BlockC
    expect(Object.values(nodeB.children)).to.be.deep.equal([2]);// BlockC
    const nodeC = lmd.getNode(blockCRoot);
    expect(nodeC).not.to.be.undefined;
  });
});