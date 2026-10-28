import {describe, expect, it} from "vitest";
import {HEAD_VOTE_COMMITTEE_SIZE, PAYLOAD_STATUS_FULL, PAYLOAD_STATUS_PENDING, SLOTS_PER_EPOCH} from "@lodestar/params";
import {Eip8453Harness} from "./harness.js";

const N = 64;

describe("eip8453 head votes", () => {
  it("records same-slot seats in head_vote_participation and ignores votes for the parent", () => {
    const h = new Eip8453Harness(N);
    h.produceBlock(1);
    const sameSlot = h.headVote(2, {slot: 1, beaconBlockRoot: h.blockRoot(1)});
    const forParent = h.headVote(2, {slot: 1, beaconBlockRoot: h.genesisRoot(), payloadStatus: PAYLOAD_STATUS_FULL});
    h.produceBlock(2, {headVotes: [sameSlot, forParent]});

    const seats = h.state.headVoteParticipation.get(SLOTS_PER_EPOCH + 1).toValue();
    // every seat is filled, including the extra seats of validators sampled more than once
    expect(seats.getTrueBitIndexes().length).toBe(HEAD_VOTE_COMMITTEE_SIZE);
    // the vote for the parent block is valid but records nothing
    expect(
      h.state.headVoteParticipation
        .get(SLOTS_PER_EPOCH + 0)
        .toValue()
        .getTrueBitIndexes().length
    ).toBe(0);
  });

  it("accepts a partial committee and a vote from an earlier slot of the epoch", () => {
    const h = new Eip8453Harness(N);
    h.produceBlock(1);
    h.produceBlock(2);
    const committee = h.headVoteCommittee(3, 1);
    const voters = [committee[0], committee[1]];
    const vote = h.headVote(3, {slot: 1, beaconBlockRoot: h.blockRoot(1)}, voters);
    h.produceBlock(3, {headVotes: [vote]});
    const seats = h.state.headVoteParticipation.get(SLOTS_PER_EPOCH + 1).toValue();
    expect(seats.getTrueBitIndexes().length).toBe(
      Array.from(committee).filter((index) => voters.includes(index)).length
    );
  });

  it("reads the committee of a previous-epoch slot from the window", () => {
    const h = new Eip8453Harness(N);
    for (let slot = 1; slot < SLOTS_PER_EPOCH + 1; slot++) h.produceBlock(slot);
    const lastOfEpoch0 = SLOTS_PER_EPOCH - 1;
    const vote = h.headVote(SLOTS_PER_EPOCH + 1, {slot: lastOfEpoch0, beaconBlockRoot: h.blockRoot(lastOfEpoch0)});
    h.produceBlock(SLOTS_PER_EPOCH + 1, {headVotes: [vote]});
    const seats = h.state.headVoteParticipation.get(lastOfEpoch0).toValue();
    expect(seats.getTrueBitIndexes().length).toBe(HEAD_VOTE_COMMITTEE_SIZE);
  });

  it("rejects support on a vote that is not of the previous slot, and a support list of the wrong shape", () => {
    const h = new Eip8453Harness(N);
    h.produceBlock(1);
    h.produceBlock(2);
    const vote = h.headVote(3, {slot: 1, beaconBlockRoot: h.blockRoot(1)});
    const supported = vote.voterIndices.map(() => true);
    expect(() => h.produceBlock(3, {headVotes: [vote], headVoteSupport: [supported]})).toThrow(/previous slot/);
    expect(() => h.produceBlock(3, {headVotes: [vote], headVoteSupport: []})).toThrow(/support length/);
    expect(() => h.produceBlock(3, {headVotes: [vote], headVoteSupport: [[false]]})).toThrow(/support bits length/);
  });

  it("rejects a vote that is too recent, empty, unsorted, outside the committee, badly signed or mis-statused", () => {
    const h = new Eip8453Harness(N);
    h.produceBlock(1);
    const tooRecent = h.headVote(2, {slot: 2, beaconBlockRoot: h.blockRoot(1)});
    expect(() => h.produceBlock(2, {headVotes: [tooRecent]})).toThrow(/too recent/);
    const empty = h.headVote(2, {slot: 1, beaconBlockRoot: h.blockRoot(1)}, []);
    expect(() => h.produceBlock(2, {headVotes: [empty]})).toThrow(/no voters/);
    const unsorted = h.headVote(2, {slot: 1, beaconBlockRoot: h.blockRoot(1)});
    unsorted.voterIndices = [...unsorted.voterIndices].reverse();
    expect(() => h.produceBlock(2, {headVotes: [unsorted]})).toThrow(/sorted/);
    const outsider = h.headVote(2, {slot: 1, beaconBlockRoot: h.blockRoot(1)});
    const committee = new Set(h.headVoteCommittee(2, 1));
    const stranger = Array.from({length: N}, (_, i) => i).find((i) => !committee.has(i)) as number;
    outsider.voterIndices = [...outsider.voterIndices, stranger].sort((a, b) => a - b);
    expect(() => h.produceBlock(2, {headVotes: [outsider]})).toThrow(/not in the committee/);
    const bad = h.headVote(2, {slot: 1, beaconBlockRoot: h.blockRoot(1)});
    bad.signature = h.headVote(2, {slot: 1, beaconBlockRoot: h.genesisRoot()}).signature;
    expect(() => h.produceBlock(2, {headVotes: [bad]})).toThrow(/signature/);
    const full = h.headVote(2, {slot: 1, beaconBlockRoot: h.blockRoot(1), payloadStatus: PAYLOAD_STATUS_FULL});
    expect(() => h.produceBlock(2, {headVotes: [full]})).toThrow(/PENDING/);
    const invalid = h.headVote(2, {slot: 1, beaconBlockRoot: h.genesisRoot(), payloadStatus: 7});
    expect(() => h.produceBlock(2, {headVotes: [invalid]})).toThrow(/payload status/);
    expect(PAYLOAD_STATUS_PENDING).toBe(2);
  });
});
