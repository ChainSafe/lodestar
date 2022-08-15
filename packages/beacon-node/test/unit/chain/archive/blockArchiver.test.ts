import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
import {ssz} from "@lodestar/types";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {ZERO_HASH_HEX} from "../../../../src/constants/index.js";
import {generateProtoBlock, generateEmptySignedBlock} from "../../../utils/block.js";
import {StubbedBeaconDb} from "../../../utils/stub/index.js";
import {testLogger} from "../../../utils/logger.js";
import {archiveBlocks} from "../../../../src/chain/archiver/archiveBlocks.js";
import {LightClientServer} from "../../../../src/chain/lightClient/index.js";

describe("block archiver task", function () {
  const logger = testLogger();

  let dbStub: StubbedBeaconDb;
  let lightclientServer: SinonStubbedInstance<LightClientServer> & LightClientServer;

  beforeEach(function () {
    dbStub = new StubbedBeaconDb();
    lightclientServer = sinon.createStubInstance(LightClientServer) as SinonStubbedInstance<LightClientServer> &
      LightClientServer;
  });

  it("should archive finalized blocks", async function () {
    const blockBuffer = Buffer.from(ssz.phase0.SignedBeaconBlock.serialize(generateEmptySignedBlock()));
    dbStub.block.getBinary.resolves(blockBuffer);
    // block i has slot i+1
    const blocks = Array.from({length: 5}, (_, i) =>
      generateProtoBlock({slot: i + 1, blockRoot: toHexString(Buffer.alloc(32, i + 1))})
    );
    const finalizedCanonicalBlocks = [blocks[4], blocks[3], blocks[1], blocks[0]];
    const finalizedNonCanonicalBlocks = [blocks[2]];
    await archiveBlocks(
      dbStub,
      lightclientServer,
      logger,
      {epoch: 5, rootHex: ZERO_HASH_HEX},
      {finalizedCanonicalBlocks, finalizedNonCanonicalBlocks}
    );

    expect(dbStub.blockArchive.batchPutBinary.getCall(0).args[0]).to.deep.equal(
      finalizedCanonicalBlocks.map((summary) => ({
        key: summary.slot,
        value: blockBuffer,
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
