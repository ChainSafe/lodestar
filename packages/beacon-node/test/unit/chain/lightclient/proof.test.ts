import {describe, it, expect, beforeAll} from "vitest";
import {BeaconStateAltair} from "@lodestar/state-transition";
import {ForkName, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {altair, ssz} from "@lodestar/types";
import {verifyMerkleBranch, hash} from "@lodestar/utils";
import {getNextSyncCommitteeBranch, getSyncCommitteesWitness} from "../../../../src/chain/lightClient/proofs.js";

const currentSyncCommitteeGindex = 54;
const nextSyncCommitteeGindex = 55;
const syncCommitteesGindex = 27;

describe("chain / lightclient / proof", () => {
  let state: BeaconStateAltair;
  let stateRoot: Uint8Array;

  const currentSyncCommittee = fillSyncCommittee(Buffer.alloc(48, 0xbb));
  const nextSyncCommittee = fillSyncCommittee(Buffer.alloc(48, 0xcc));

  beforeAll(() => {
    state = ssz.altair.BeaconState.defaultViewDU();
    state.currentSyncCommittee = ssz.altair.SyncCommittee.toViewDU(currentSyncCommittee);
    state.nextSyncCommittee = ssz.altair.SyncCommittee.toViewDU(nextSyncCommittee);
    // Note: .hashTreeRoot() automatically commits()
    stateRoot = state.hashTreeRoot();
  });

  it("SyncCommittees proof", () => {
    const syncCommitteesWitness = getSyncCommitteesWitness(ForkName.altair, state);
    const syncCommitteesLeaf = hash(
      syncCommitteesWitness.currentSyncCommitteeRoot,
      syncCommitteesWitness.nextSyncCommitteeRoot
    );

    expect(
      verifyMerkleBranch(
        syncCommitteesLeaf,
        syncCommitteesWitness.witness,
        ...fromGindex(syncCommitteesGindex),
        stateRoot
      )
    ).toBe(true);
  });

  it("currentSyncCommittee proof", () => {
    const syncCommitteesWitness = getSyncCommitteesWitness(ForkName.altair, state);
    const currentSyncCommitteeBranch = [syncCommitteesWitness.nextSyncCommitteeRoot, ...syncCommitteesWitness.witness];

    expect(
      verifyMerkleBranch(
        ssz.altair.SyncCommittee.hashTreeRoot(currentSyncCommittee),
        currentSyncCommitteeBranch,
        ...fromGindex(currentSyncCommitteeGindex),
        stateRoot
      )
    ).toBe(true);
  });

  it("nextSyncCommittee proof", () => {
    const syncCommitteesWitness = getSyncCommitteesWitness(ForkName.altair, state);
    const nextSyncCommitteeBranch = getNextSyncCommitteeBranch(syncCommitteesWitness);

    expect(
      verifyMerkleBranch(
        ssz.altair.SyncCommittee.hashTreeRoot(nextSyncCommittee),
        nextSyncCommitteeBranch,
        ...fromGindex(nextSyncCommitteeGindex),
        stateRoot
      )
    ).toBe(true);
  });
});

function fillSyncCommittee(pubkey: Uint8Array): altair.SyncCommittee {
  return {
    aggregatePubkey: pubkey,
    pubkeys: repeat(SYNC_COMMITTEE_SIZE, pubkey),
  };
}

function repeat<T>(count: number, el: T): T[] {
  const arr: T[] = [];
  for (let i = 0; i < count; i++) {
    arr.push(el);
  }
  return arr;
}

function fromGindex(gindex: number): [number, number] {
  const depth = Math.floor(Math.log2(gindex));
  const firstIndex = 2 ** depth;
  return [depth, gindex % firstIndex];
}
