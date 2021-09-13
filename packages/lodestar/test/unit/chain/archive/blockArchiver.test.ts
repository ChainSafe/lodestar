import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
import {ssz} from "@chainsafe/lodestar-types";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {generateBlockSummary, generateEmptySignedBlock} from "../../../utils/block";
import {StubbedBeaconDb} from "../../../utils/stub";
import {testLogger} from "../../../utils/logger";
import {archiveBlocks} from "../../../../src/chain/archiver/archiveBlocks";

describe("block archiver task", function () {
  const sandbox = sinon.createSandbox();
  const logger = testLogger();

  let dbStub: StubbedBeaconDb;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice>;

  beforeEach(function () {
    dbStub = new StubbedBeaconDb(sandbox);
    forkChoiceStub = sinon.createStubInstance(ForkChoice);
  });

  it("should archive finalized blocks", async function () {
    const blockBuffer = Buffer.from(ssz.phase0.SignedBeaconBlock.serialize(generateEmptySignedBlock()));
    dbStub.block.getBinary.resolves(blockBuffer);
    // block i has slot i+1
    const blocks = Array.from({length: 5}, (_, i) =>
      generateBlockSummary({slot: i + 1, blockRoot: Buffer.alloc(32, i + 1)})
    );
    const canonicalBlocks = [blocks[4], blocks[3], blocks[1], blocks[0]];
    const nonCanonicalBlocks = [blocks[2]];
    forkChoiceStub.getAllAncestorBlocks.returns(canonicalBlocks);
    forkChoiceStub.getAllNonAncestorBlocks.returns(nonCanonicalBlocks);
    await archiveBlocks(dbStub, forkChoiceStub, logger, {epoch: 5, root: ZERO_HASH});
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
      dbStub.block.batchDelete.calledWith(
        [blocks[4], blocks[3], blocks[1], blocks[0]].map((summary) => summary.blockRoot)
      )
    ).to.be.true;
    // delete non canonical blocks
    expect(dbStub.block.batchDelete.calledWith([blocks[2]].map((summary) => summary.blockRoot))).to.be.true;
  });
});
