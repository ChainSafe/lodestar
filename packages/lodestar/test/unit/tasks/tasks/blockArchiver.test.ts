import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
import pipe from "it-pipe";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";

import {ForkChoice} from "../../../../src/chain";
import {ArchiveBlocksTask} from "../../../../src/tasks/tasks/archiveBlocks";
import {generateEmptySignedBlock} from "../../../utils/block";
import {StubbedBeaconDb} from "../../../utils/stub";
import {silentLogger} from "../../../utils/logger";

describe("block archiver task", function () {
  const sandbox = sinon.createSandbox();
  const logger = silentLogger;

  let dbStub: StubbedBeaconDb;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice> & ForkChoice;

  beforeEach(function () {
    dbStub = new StubbedBeaconDb(sandbox);
    forkChoiceStub = sinon.createStubInstance(ForkChoice) as SinonStubbedInstance<ForkChoice> & ForkChoice;
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
    const finalizedCheckpoint = {
      epoch: 3,
      root: config.types.BeaconBlock.hashTreeRoot(finalizedBlock.message),
    };
    const blocks = [
      {key: config.types.BeaconBlock.hashTreeRoot(blockA.message), value: blockA},
      {key: config.types.BeaconBlock.hashTreeRoot(blockB.message), value: blockB},
      {key: config.types.BeaconBlock.hashTreeRoot(blockC.message), value: blockC},
      {key: config.types.BeaconBlock.hashTreeRoot(blockD.message), value: blockD},
      {key: config.types.BeaconBlock.hashTreeRoot(finalizedBlock.message), value: finalizedBlock},
      {key: config.types.BeaconBlock.hashTreeRoot(blockE.message), value: blockE},
    ];
    dbStub.block.entriesStream.resolves(pipe(blocks));
    forkChoiceStub.isDescendant.withArgs(blocks[0].key, finalizedCheckpoint.root).returns(true);
    forkChoiceStub.isDescendant.withArgs(blocks[1].key, finalizedCheckpoint.root).returns(true);
    forkChoiceStub.isDescendant.withArgs(blocks[2].key, finalizedCheckpoint.root).returns(false); // not a descendant
    forkChoiceStub.isDescendant.withArgs(blocks[3].key, finalizedCheckpoint.root).returns(true);
    forkChoiceStub.isDescendant.withArgs(blocks[4].key, finalizedCheckpoint.root).returns(true);
    const blockArchiveSpy = sinon.spy();
    dbStub.blockArchive.add.callsFake(blockArchiveSpy);
    const blockSpy = sinon.spy();
    dbStub.block.batchDelete.callsFake(blockSpy);

    const archiverTask = new ArchiveBlocksTask(
      config,
      {
        db: dbStub,
        forkChoice: forkChoiceStub,
        logger,
      },
      finalizedCheckpoint
    );
    await archiverTask.run();

    expect(dbStub.blockArchive.add.calledWith(finalizedBlock)).to.be.true;
    expect(dbStub.blockArchive.add.calledWith(blockD)).to.be.true;
    expect(dbStub.blockArchive.add.calledWith(blockB)).to.be.true;
    expect(dbStub.blockArchive.add.calledWith(blockA)).to.be.true;
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
