import {BeaconStateAltair} from "@chainsafe/lodestar-beacon-state-transition";
import {SYNC_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {verifyMerkleBranch, hash} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import {getNextSyncCommitteeBranch, getSyncCommitteesWitness} from "../../../../src/chain/lightClient/proofs.js";

const currentSyncCommitteeGindex = 54;
const nextSyncCommitteeGindex = 55;
const syncCommitteesGindex = 27;

describe("chain / lightclient / proof", () => {
  let state: BeaconStateAltair;
  let stateRoot: Uint8Array;

  const currentSyncCommittee = fillSyncCommittee(Buffer.alloc(48, 0xbb));
  const nextSyncCommittee = fillSyncCommittee(Buffer.alloc(48, 0xcc));

  before("random state", () => {
    state = ssz.altair.BeaconState.defaultViewDU();
    state.currentSyncCommittee = ssz.altair.SyncCommittee.toViewDU(currentSyncCommittee);
    state.nextSyncCommittee = ssz.altair.SyncCommittee.toViewDU(nextSyncCommittee);
    // Note: .hashTreeRoot() automatically commits()
    stateRoot = state.hashTreeRoot();
  });

  it("SyncCommittees proof", () => {
    const syncCommitteesWitness = getSyncCommitteesWitness(state);
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
    ).to.equal(true, "Invalid proof");
  });

  it("currentSyncCommittee proof", () => {
    const syncCommitteesWitness = getSyncCommitteesWitness(state);
    const currentSyncCommitteeBranch = [syncCommitteesWitness.nextSyncCommitteeRoot, ...syncCommitteesWitness.witness];

    expect(
      verifyMerkleBranch(
        ssz.altair.SyncCommittee.hashTreeRoot(currentSyncCommittee),
        currentSyncCommitteeBranch,
        ...fromGindex(currentSyncCommitteeGindex),
        stateRoot
      )
    ).to.equal(true, "Invalid proof");
  });

  it("nextSyncCommittee proof", () => {
    const syncCommitteesWitness = getSyncCommitteesWitness(state);
    const nextSyncCommitteeBranch = getNextSyncCommitteeBranch(syncCommitteesWitness);

    expect(
      verifyMerkleBranch(
        ssz.altair.SyncCommittee.hashTreeRoot(nextSyncCommittee),
        nextSyncCommitteeBranch,
        ...fromGindex(nextSyncCommitteeGindex),
        stateRoot
      )
    ).to.equal(true, "Invalid proof");
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
