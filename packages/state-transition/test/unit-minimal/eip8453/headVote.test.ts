import {describe, expect, it} from "vitest";
import {HEAD_VOTE_COMMITTEE_SIZE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {Eip8453Harness} from "./harness.js";

const N = 64;

describe("eip8453 head votes", () => {
  it("records same-slot seats in head_vote_participation and ignores votes for the parent", () => {
    const h = new Eip8453Harness(N);
    h.produceBlock(1);
    const sameSlot = h.headVote(2, {slot: 1, beaconBlockRoot: h.blockRoot(1)});
    const forParent = h.headVote(2, {slot: 1, beaconBlockRoot: h.genesisRoot()});
    h.produceBlock(2, {headVotes: [sameSlot, forParent]});

    const seats = h.state.headVoteParticipation.get(SLOTS_PER_EPOCH + 1).toValue();
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

  it("rejects a support bit on a vote that is not of the previous slot", () => {
    const h = new Eip8453Harness(N);
    h.produceBlock(1);
    h.produceBlock(2);
    const vote = h.headVote(3, {slot: 1, beaconBlockRoot: h.blockRoot(1)});
    expect(() => h.produceBlock(3, {headVotes: [vote], headVoteSupportBits: [true]})).toThrow(/previous slot/);
    expect(() => h.produceBlock(3, {headVotes: [vote], headVoteSupportBits: []})).toThrow(/support bits length/);
  });

  it("rejects a vote that is too recent, empty, or badly signed", () => {
    const h = new Eip8453Harness(N);
    h.produceBlock(1);
    const tooRecent = h.headVote(2, {slot: 2, beaconBlockRoot: h.blockRoot(1)});
    expect(() => h.produceBlock(2, {headVotes: [tooRecent]})).toThrow(/too recent/);
    const empty = h.headVote(2, {slot: 1, beaconBlockRoot: h.blockRoot(1)}, []);
    expect(() => h.produceBlock(2, {headVotes: [empty]})).toThrow(/no participants/);
    const bad = h.headVote(2, {slot: 1, beaconBlockRoot: h.blockRoot(1)});
    bad.signature = h.headVote(2, {slot: 1, beaconBlockRoot: h.genesisRoot()}).signature;
    expect(() => h.produceBlock(2, {headVotes: [bad]})).toThrow(/signature/);
  });
});
