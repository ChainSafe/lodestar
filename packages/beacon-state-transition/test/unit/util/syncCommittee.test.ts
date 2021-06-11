import {SYNC_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import {extractParticipantIndices} from "../../../src";

describe("extractParticipantIndices", function () {
  const committeeIndices = Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => i * 2);
  // 3 first bits are true
  const syncCommitteeBits = Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => {
    return i < 3 ? true : false;
  });

  it("should extract from TreeBacked SyncAggregate", function () {
    const syncAggregate = ssz.altair.SyncAggregate.defaultTreeBacked();
    syncAggregate.syncCommitteeBits = syncCommitteeBits;
    expect(extractParticipantIndices(committeeIndices, syncAggregate)).to.be.deep.equal(
      [0, 2, 4],
      "Incorrect participant indices from TreeBacked SyncAggregate"
    );
  });

  it("should extract from struct SyncAggregate", function () {
    const syncAggregate = ssz.altair.SyncAggregate.defaultValue();
    syncAggregate.syncCommitteeBits = syncCommitteeBits;
    expect(extractParticipantIndices(committeeIndices, syncAggregate)).to.be.deep.equal(
      [0, 2, 4],
      "Incorrect participant indices from TreeBacked SyncAggregate"
    );
  });
});
