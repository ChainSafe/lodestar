import {MAX_VALIDATORS_PER_COMMITTEE, SYNC_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {expect} from "chai";
import {
  getUint8ByteToBitBooleanArray,
  bitsToUint8Array,
  zipIndexesSyncCommitteeBits,
  zipAllIndexesSyncCommitteeBits,
  getSingleBitIndex,
  AggregationBitsErrorCode,
} from "../../../src";

const BITS_PER_BYTE = 8;

describe("aggregationBits", function () {
  const testCases: {name: string; data: boolean[]; numBytes: number}[] = [
    {name: "8 bits all true", data: [true, true, true, true, true, true, true, true], numBytes: 1},
    {name: "8 bits with true and false", data: [false, false, false, false, false, true, false, true], numBytes: 1},
    {
      name: "10 bits with true and false",
      data: [false, false, false, false, false, true, false, true, true, true],
      numBytes: 2,
    },
    {
      name: "" + MAX_VALIDATORS_PER_COMMITTEE + " bits all true",
      data: Array.from({length: MAX_VALIDATORS_PER_COMMITTEE}, () => true),
      numBytes: Math.ceil(MAX_VALIDATORS_PER_COMMITTEE / 8),
    },
  ];

  it("getUint8ByteToBitBooleanArray", () => {
    expect(getUint8ByteToBitBooleanArray(1)).to.be.deep.equal([true, false, false, false, false, false, false, false]);
    expect(getUint8ByteToBitBooleanArray(5)).to.be.deep.equal([true, false, true, false, false, false, false, false]);
  });

  for (const {name, data, numBytes} of testCases) {
    it(name, () => {
      const tree = ssz.phase0.CommitteeBits.createTreeBackedFromStruct(data as List<boolean>);
      const aggregationBytes = bitsToUint8Array(tree, ssz.phase0.CommitteeBits);
      expect(aggregationBytes.length).to.be.equal(numBytes, "number of bytes is incorrect");
      const aggregationBits: boolean[] = [];
      for (let i = 0; i < tree.length; i++) {
        aggregationBits.push(getAggregationBit(aggregationBytes, i));
      }
      expect(aggregationBits).to.be.deep.equal(data, "incorrect extracted aggregationBits");
    });
  }

  it("getUint8ByteToBitBooleanArray - all values in 8 bytes", () => {
    for (let i = 0; i <= 0xff; i++) {
      const boolArr = getUint8ByteToBitBooleanArray(i);
      const tree = ssz.phase0.CommitteeBits.createTreeBackedFromStruct(boolArr as List<boolean>);
      const bytes = tree.serialize();
      expect(bytes[0]).to.equal(i, `Wrong serialization of ${i}: ${JSON.stringify(boolArr)}`);
    }
  });
});

describe("zipIndexesSyncCommitteeBits and zipAllIndexesSyncCommitteeBits", function () {
  const committeeIndices = Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => i * 2);
  const pivot = 3;
  // 3 first bits are true
  const syncCommitteeBits = Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => {
    return i < pivot ? true : false;
  });

  // remaining bits are false
  const expectedUnparticipantIndices: number[] = [];
  for (let i = pivot; i < SYNC_COMMITTEE_SIZE; i++) {
    expectedUnparticipantIndices.push(committeeIndices[i]);
  }

  it("should extract from TreeBacked SyncAggregate", function () {
    const syncAggregate = ssz.altair.SyncAggregate.defaultTreeBacked();
    syncAggregate.syncCommitteeBits = syncCommitteeBits;
    expect(zipIndexesSyncCommitteeBits(committeeIndices, syncAggregate.syncCommitteeBits)).to.be.deep.equal(
      [0, 2, 4],
      "Incorrect participant indices from TreeBacked SyncAggregate"
    );
    const [participantIndices, unparticipantIndices] = zipAllIndexesSyncCommitteeBits(
      committeeIndices,
      syncAggregate.syncCommitteeBits
    );
    expect(participantIndices).to.be.deep.equal(
      [0, 2, 4],
      "Incorrect participant indices from TreeBacked SyncAggregate"
    );
    expect(unparticipantIndices).to.be.deep.equal(
      expectedUnparticipantIndices,
      "Incorrect unparticipant indices from TreeBacked SyncAggregate"
    );
  });

  it("should extract from struct SyncAggregate", function () {
    const syncAggregate = ssz.altair.SyncAggregate.defaultValue();
    syncAggregate.syncCommitteeBits = syncCommitteeBits;
    expect(zipIndexesSyncCommitteeBits(committeeIndices, syncAggregate.syncCommitteeBits)).to.be.deep.equal(
      [0, 2, 4],
      "Incorrect participant indices from struct SyncAggregate"
    );
    const [participantIndices, unparticipantIndices] = zipAllIndexesSyncCommitteeBits(
      committeeIndices,
      syncAggregate.syncCommitteeBits
    );
    expect(participantIndices).to.be.deep.equal([0, 2, 4], "Incorrect participant indices from struct SyncAggregate");
    expect(unparticipantIndices).to.be.deep.equal(
      expectedUnparticipantIndices,
      "Incorrect unparticipant indices from struct SyncAggregate"
    );
  });
});

describe("getSingleBitIndex", () => {
  const len = MAX_VALIDATORS_PER_COMMITTEE;

  const testCases: {id: string; bitList: boolean[]; res: number | Error | string}[] = [
    {id: "bit 0 true", bitList: [true, false, false, false, false, false, false, false, false, false], res: 0},
    {id: "bit 4 true", bitList: [false, false, false, false, true, false, false, false, false, false], res: 4},
    {id: "bit 9 true", bitList: [false, false, false, false, false, false, false, false, false, true], res: 9},
    {
      id: "2 bits true",
      bitList: [true, false, false, false, true, false, false, false, false, false],
      res: AggregationBitsErrorCode.NOT_EXACTLY_ONE_BIT_SET,
    },
    {
      id: `${len} all true`,
      bitList: Array.from({length: len}, () => true),
      res: AggregationBitsErrorCode.NOT_EXACTLY_ONE_BIT_SET,
    },
    {
      id: `${len} all false`,
      bitList: Array.from({length: len}, () => false),
      res: AggregationBitsErrorCode.NOT_EXACTLY_ONE_BIT_SET,
    },
  ];

  for (const {id, res, bitList} of testCases) {
    const struct = bitList as List<boolean>;
    const treeBacked = ssz.phase0.CommitteeBits.createTreeBackedFromStruct(struct);

    it(`${id} - struct`, () => {
      if (typeof res === "number") {
        expect(getSingleBitIndex(struct)).to.equal(res);
      } else {
        expect(() => getSingleBitIndex(struct)).to.throw(res as Error);
      }
    });

    it(`${id} - treeBacked`, () => {
      if (typeof res === "number") {
        expect(getSingleBitIndex(treeBacked)).to.equal(res);
      } else {
        expect(() => getSingleBitIndex(treeBacked)).to.throw(res as Error);
      }
    });
  }
});

/**
 * Get aggregation bit (true/false) from an aggregation bytes array and validator index in committee.
 * Notice: If we want to access the bit in batch, using this method is not efficient, check the performance
 *         test for an example of how to do that.
 */
export function getAggregationBit(attBytes: number[] | Uint8Array, indexInCommittee: number): boolean {
  const byteIndex = Math.floor(indexInCommittee / BITS_PER_BYTE);
  const indexInByte = indexInCommittee % BITS_PER_BYTE;
  return getUint8ByteToBitBooleanArray(attBytes[byteIndex])[indexInByte];
}
