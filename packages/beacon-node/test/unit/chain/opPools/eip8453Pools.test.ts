import {describe, expect, it} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {HeadVotePool} from "../../../../src/chain/opPools/headVotePool.js";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";

const sk = (i: number): SecretKey => SecretKey.fromKeygen(new Uint8Array(32).fill(i + 1));
const root = (byte: number): Uint8Array => new Uint8Array(32).fill(byte);
const signingRoot = root(0x55);

describe("HeadVotePool", () => {
  it("aggregates votes of the previous slot with support and older votes without, sorted by voter", () => {
    const pool = new HeadVotePool();
    const data = {slot: 9, beaconBlockRoot: root(0xaa), payloadStatus: 2};
    for (const index of [7, 3, 5]) {
      const outcome = pool.add(
        {validatorIndex: index, data, signature: sk(index).sign(signingRoot).toBytes()},
        "0xdata"
      );
      expect(outcome).toBe(InsertOutcome.NewData);
    }
    expect(pool.add({validatorIndex: 3, data, signature: sk(3).sign(signingRoot).toBytes()}, "0xdata")).toBe(
      InsertOutcome.AlreadyKnown
    );
    const older = {slot: 8, beaconBlockRoot: root(0xbb), payloadStatus: 1};
    pool.add({validatorIndex: 1, data: older, signature: sk(1).sign(signingRoot).toBytes()}, "0xolder");

    const {headVotes, headVoteSupport} = pool.getHeadVotesForBlock(10, (rootHex) => rootHex === `0x${"aa".repeat(32)}`);
    expect(headVotes).toHaveLength(2);
    expect(headVotes[0].voterIndices).toEqual([3, 5, 7]);
    expect(headVotes[0].data).toEqual(data);
    expect(headVoteSupport[0].toBoolArray()).toEqual([true, true, true]);
    // the older vote is included without support, whatever its block
    expect(headVotes[1].voterIndices).toEqual([1]);
    expect(headVoteSupport[1].toBoolArray()).toEqual([false]);
    expect(pool.getVoteCount()).toBe(4);

    // the proposer's filter keeps older voters selectively; previous-slot votes are never filtered
    const filtered = pool.getHeadVotesForBlock(
      10,
      () => true,
      (voteData, index) => voteData.slot === 8 && index !== 1
    );
    expect(filtered.headVotes).toHaveLength(1);
    expect(filtered.headVotes[0].voterIndices).toEqual([3, 5, 7]);
  });

  it("prunes votes older than the previous epoch", () => {
    const pool = new HeadVotePool();
    const data = {slot: 2, beaconBlockRoot: root(0xaa), payloadStatus: 2};
    pool.add({validatorIndex: 1, data, signature: sk(1).sign(signingRoot).toBytes()}, "0xdata");
    pool.prune(3 * SLOTS_PER_EPOCH);
    expect(pool.getVoteCount()).toBe(0);
    expect(() => pool.add({validatorIndex: 1, data, signature: sk(1).sign(signingRoot).toBytes()}, "0xdata")).toThrow();
  });
});
