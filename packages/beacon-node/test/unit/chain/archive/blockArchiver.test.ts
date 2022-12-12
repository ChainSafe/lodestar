import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
import {ssz} from "@lodestar/types";
import {ForkChoice} from "@lodestar/fork-choice";
import {config} from "@lodestar/config/default";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {ZERO_HASH_HEX} from "../../../../src/constants/index.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";
import {StubbedBeaconDb} from "../../../utils/stub/index.js";
import {testLogger} from "../../../utils/logger.js";
import {archiveBlocks} from "../../../../src/chain/archiver/archiveBlocks.js";
import {LightClientServer} from "../../../../src/chain/lightClient/index.js";

describe("block archiver task", function () {
  const logger = testLogger();

  let dbStub: StubbedBeaconDb;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice>;
  let lightclientServer: SinonStubbedInstance<LightClientServer> & LightClientServer;

  beforeEach(function () {
    dbStub = new StubbedBeaconDb();
    forkChoiceStub = sinon.createStubInstance(ForkChoice);
    lightclientServer = sinon.createStubInstance(LightClientServer) as SinonStubbedInstance<LightClientServer> &
      LightClientServer;
  });

  it("should archive finalized blocks", async function () {
    const blockBytes = ssz.phase0.SignedBeaconBlock.serialize(ssz.phase0.SignedBeaconBlock.defaultValue());
    dbStub.block.getBinary.resolves(Buffer.from(blockBytes));
    // block i has slot i+1
    const blocks = Array.from({length: 5}, (_, i) =>
      generateProtoBlock({slot: i + 1, blockRoot: toHexString(Buffer.alloc(32, i + 1))})
    );
    const canonicalBlocks = [blocks[4], blocks[3], blocks[1], blocks[0]];
    const nonCanonicalBlocks = [blocks[2]];
    const currentEpoch = 8;
    forkChoiceStub.getAllAncestorBlocks.returns(canonicalBlocks);
    forkChoiceStub.getAllNonAncestorBlocks.returns(nonCanonicalBlocks);
    await archiveBlocks(
      config,
      dbStub,
      forkChoiceStub,
      lightclientServer,
      logger,
      {epoch: 5, rootHex: ZERO_HASH_HEX},
      currentEpoch
    );

    expect(dbStub.blockArchive.batchPutBinary.getCall(0).args[0]).to.deep.equal(
      canonicalBlocks.map((summary) => ({
        key: summary.slot,
        value: blockBytes,
        slot: summary.slot,
        blockRoot: fromHexString(summary.blockRoot),
        parentRoot: fromHexString(summary.parentRoot),
      })),
      "blockArchive.batchPutBinary called with wrong args"
    );

    // delete canonical blocks
    expect(
      dbStub.block.batchDelete.calledWith(
        [blocks[4], blocks[3], blocks[1], blocks[0]].map((summary) => fromHexString(summary.blockRoot))
      )
    ).to.equal(true);
    // delete non canonical blocks
    expect(dbStub.block.batchDelete.calledWith([blocks[2]].map((summary) => fromHexString(summary.blockRoot)))).to.be
      .true;
  });
});
