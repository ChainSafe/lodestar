import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";

import {config} from "@chainsafe/lodestar-config/mainnet";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";

import {ForkChoice} from "../../../../src/chain";
import {ArchiveBlocksTask} from "../../../../src/tasks/tasks/archiveBlocks";
import {generateBlockSummary, generateEmptySignedBlock} from "../../../utils/block";
import {StubbedBeaconDb} from "../../../utils/stub";
import {testLogger} from "../../../utils/logger";

describe("block archiver task", function () {
  const sandbox = sinon.createSandbox();
  const logger = testLogger();

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
    const blockBuffer = Buffer.from(config.types.phase0.SignedBeaconBlock.serialize(generateEmptySignedBlock()));
    dbStub.block.getBinary.resolves(blockBuffer);
    const canonicalBlocks = [
      generateBlockSummary({slot: 5}),
      generateBlockSummary({slot: 4}),
      generateBlockSummary({slot: 2}),
      generateBlockSummary({slot: 1}),
    ];
    forkChoiceStub.iterateBlockSummaries.returns(canonicalBlocks);
    forkChoiceStub.iterateNonAncestors.returns([generateBlockSummary({slot: 3})]);
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
      dbStub.blockArchive.batchPutBinary.calledWith(
        canonicalBlocks.map((summary) => ({
          key: summary.slot,
          value: blockBuffer,
          summary,
        }))
      )
    ).to.be.true;
    // delete canonical blocks
    expect(
      dbStub.block.batchDelete.calledWith([
        {root: ZERO_HASH, slot: 5},
        {root: ZERO_HASH, slot: 4},
        {root: ZERO_HASH, slot: 2},
        {root: ZERO_HASH, slot: 1},
      ])
    ).to.be.true;
    // delete non canonical blocks
    expect(dbStub.block.batchDelete.calledWith([{root: ZERO_HASH, slot: 3}])).to.be.true;
  });
});
