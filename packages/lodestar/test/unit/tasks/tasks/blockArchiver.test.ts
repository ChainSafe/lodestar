import {describe, it, beforeEach} from "mocha";
import {expect} from "chai";
import sinon from "sinon";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";

import {ArchiveBlocksTask} from "../../../../src/tasks/tasks/archiveBlocks";
import {generateEmptySignedBlock} from "../../../utils/block";
import {StubbedBeaconDb} from "../../../utils/stub";

describe("block archiver task", function () {

  const sandbox = sinon.createSandbox();

  let dbStub: StubbedBeaconDb, loggerStub: any;

  beforeEach(function () {
    dbStub = new StubbedBeaconDb(sandbox);
    loggerStub = sandbox.createStubInstance(WinstonLogger);
  });

  /**
   * A - B - D - finalized - E
   *      \
   *       C
   */
  it("should archive finalized blocks on same chain", async function () {
    const blockA = generateEmptySignedBlock();
    const blockB = generateEmptySignedBlock();
    blockB.message.slot = 1;
    blockB.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(blockA.message);
    // blockC is not archieved because not on the same chain
    const blockC = generateEmptySignedBlock();
    blockC.message.slot = 2;
    blockC.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(blockB.message);
    const blockD = generateEmptySignedBlock();
    blockD.message.slot = 3;
    blockD.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(blockB.message);
    const finalizedBlock = generateEmptySignedBlock();
    finalizedBlock.message.slot = computeStartSlotAtEpoch(config, 3);
    finalizedBlock.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(blockD.message);
    // blockE is not archieved due to its epoch
    const blockE = generateEmptySignedBlock();
    blockE.message.slot = finalizedBlock.message.slot + 1;
    const archiverTask = new ArchiveBlocksTask(
      config,
      {
        db: dbStub,
        logger: loggerStub
      }, {
        slot: finalizedBlock.message.slot,
        blockRoot: config.types.BeaconBlock.hashTreeRoot(finalizedBlock.message),
        parentRoot: finalizedBlock.message.parentRoot as Uint8Array,
        stateRoot: finalizedBlock.message.stateRoot as Uint8Array,
        justifiedCheckpoint: {epoch: 0, root: Buffer.alloc(32)},
        finalizedCheckpoint: {epoch: 0, root: Buffer.alloc(32)}
      },
      []
    );
    dbStub.block.entries.resolves([
      {key: config.types.BeaconBlock.hashTreeRoot(blockA.message), value: blockA},
      {key: config.types.BeaconBlock.hashTreeRoot(blockB.message), value: blockB},
      {key: config.types.BeaconBlock.hashTreeRoot(blockC.message), value: blockC},
      {key: config.types.BeaconBlock.hashTreeRoot(blockD.message), value: blockD},
      {key: config.types.BeaconBlock.hashTreeRoot(finalizedBlock.message), value: finalizedBlock},
      {key: config.types.BeaconBlock.hashTreeRoot(blockE.message), value: blockE},
    ]);
    const blockArchiveSpy = sinon.spy();
    dbStub.blockArchive.batchAdd.callsFake(blockArchiveSpy);
    const blockSpy = sinon.spy();
    dbStub.block.batchDelete.callsFake(blockSpy);

    await archiverTask.run();

    expect(dbStub.blockArchive.batchAdd.calledOnce).to.be.true;
    expect(blockArchiveSpy.args[0][0]).to.be.deep.equal([finalizedBlock, blockD, blockB, blockA]);
    expect(dbStub.block.batchDelete.calledOnce).to.be.true;
    expect(blockSpy.args[0][0]).to.be.deep.equal([
      config.types.BeaconBlock.hashTreeRoot(blockA.message),
      config.types.BeaconBlock.hashTreeRoot(blockB.message),
      config.types.BeaconBlock.hashTreeRoot(blockC.message),
      config.types.BeaconBlock.hashTreeRoot(blockD.message),
      config.types.BeaconBlock.hashTreeRoot(finalizedBlock.message),
    ]);
  });

});
