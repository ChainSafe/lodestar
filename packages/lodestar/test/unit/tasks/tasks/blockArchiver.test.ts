import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
import pipe from "it-pipe";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {computeStartSlotAtEpoch, ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";

import {ForkChoice} from "../../../../src/chain";
import {ArchiveBlocksTask} from "../../../../src/tasks/tasks/archiveBlocks";
import {generateBlockSummary, generateEmptySignedBlock} from "../../../utils/block";
import {StubbedBeaconDb} from "../../../utils/stub";
import {silentLogger} from "../../../utils/logger";

describe("block archiver task", function () {
  const sandbox = sinon.createSandbox();
  const logger = silentLogger;

  let dbStub: StubbedBeaconDb;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice>;

  beforeEach(function () {
    dbStub = new StubbedBeaconDb(sandbox);
    forkChoiceStub = sinon.createStubInstance(ForkChoice);
  });

  /**
   * A - B - D - finalized - E
   *      \
   *       C
   */
  it("should archive finalized blocks on same chain", async function () {
    dbStub.block.get.resolves(generateEmptySignedBlock());
    const canonicalBlocks = [
      generateBlockSummary({slot: 5}),
      generateBlockSummary({slot: 4}),
      generateBlockSummary({slot: 2}),
      generateBlockSummary({slot: 1}),
    ];
    forkChoiceStub.iterateBlockSummaries.returns(canonicalBlocks);
    forkChoiceStub.forwardIterateBlockSummaries.returns([generateBlockSummary({slot: 3})]);
    forkChoiceStub.isDescendant.returns(false);
    const archiverTask = new ArchiveBlocksTask(
      config,
      {
        db: dbStub,
        forkChoice: forkChoiceStub,
        logger,
      },
      {
        epoch: 5,
        root: ZERO_HASH,
      }
    );
    await archiverTask.run();
    expect(
      dbStub.blockArchive.batchPut.calledWith(
        canonicalBlocks.map((b) => ({key: b.slot, value: generateEmptySignedBlock()}))
      )
    ).to.be.true;
    // delete canonical blocks
    expect(dbStub.block.batchDelete.calledWith([ZERO_HASH, ZERO_HASH, ZERO_HASH, ZERO_HASH])).to.be.true;
    // delete non canonical blocks
    expect(dbStub.block.batchDelete.calledWith([ZERO_HASH])).to.be.true;
  });
});
