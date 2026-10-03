import {beforeAll, describe, expect, it} from "vitest";
import {
  CURRENT_SYNC_COMMITTEE_GINDEX,
  CURRENT_SYNC_COMMITTEE_GINDEX_ELECTRA,
  CURRENT_SYNC_COMMITTEE_GINDEX_GLOAS,
  ForkName,
  NEXT_SYNC_COMMITTEE_GINDEX,
  NEXT_SYNC_COMMITTEE_GINDEX_ELECTRA,
  NEXT_SYNC_COMMITTEE_GINDEX_GLOAS,
  SYNC_COMMITTEE_SIZE,
} from "@lodestar/params";
import {BeaconStateAltair, BeaconStateElectra, BeaconStateGloas} from "@lodestar/state-transition";
import {altair, ssz} from "@lodestar/types";
import {hash, verifyMerkleBranch} from "@lodestar/utils";
import {
  getCurrentSyncCommitteeBranch,
  getNextSyncCommitteeBranch,
  getSyncCommitteesWitness,
} from "../../../../src/chain/lightClient/proofs.js";
import {NUM_WITNESS, NUM_WITNESS_ELECTRA} from "../../../../src/db/repositories/lightclientSyncCommitteeWitness.js";

const syncCommitteesGindex = 27;
const syncCommitteesGindexElectra = 43;

describe("chain / lightclient / proof", () => {
  let stateAltair: BeaconStateAltair;
  let stateElectra: BeaconStateElectra;
  let stateGloas: BeaconStateGloas;
  let stateRootAltair: Uint8Array;
  let stateRootElectra: Uint8Array;
  let stateRootGloas: Uint8Array;

  const currentSyncCommittee = fillSyncCommittee(Buffer.alloc(48, 0xbb));
  const nextSyncCommittee = fillSyncCommittee(Buffer.alloc(48, 0xcc));

  beforeAll(() => {
    stateAltair = ssz.altair.BeaconState.defaultViewDU();
    stateAltair.currentSyncCommittee = ssz.altair.SyncCommittee.toViewDU(currentSyncCommittee);
    stateAltair.nextSyncCommittee = ssz.altair.SyncCommittee.toViewDU(nextSyncCommittee);
    // Note: .hashTreeRoot() automatically commits()
    stateRootAltair = stateAltair.hashTreeRoot();

    stateElectra = ssz.electra.BeaconState.defaultViewDU();
    stateElectra.currentSyncCommittee = ssz.altair.SyncCommittee.toViewDU(currentSyncCommittee);
    stateElectra.nextSyncCommittee = ssz.altair.SyncCommittee.toViewDU(nextSyncCommittee);
    stateRootElectra = stateElectra.hashTreeRoot();

    stateGloas = ssz.gloas.BeaconState.defaultViewDU();
    stateGloas.currentSyncCommittee = ssz.altair.SyncCommittee.toViewDU(currentSyncCommittee);
    stateGloas.nextSyncCommittee = ssz.altair.SyncCommittee.toViewDU(nextSyncCommittee);
    stateRootGloas = stateGloas.hashTreeRoot();
  });

  it("SyncCommittees proof altair", () => {
    const syncCommitteesWitness = getSyncCommitteesWitness(ForkName.altair, stateAltair);
    const syncCommitteesLeaf = hash(
      syncCommitteesWitness.currentSyncCommitteeRoot,
      syncCommitteesWitness.nextSyncCommitteeRoot
    );

    expect(syncCommitteesWitness.witness.length).toBe(NUM_WITNESS);
    expect(
      verifyMerkleBranch(
        syncCommitteesLeaf,
        syncCommitteesWitness.witness,
        ...fromGindex(syncCommitteesGindex),
        stateRootAltair
      )
    ).toBe(true);
  });

  it("currentSyncCommittee proof altair", () => {
    const syncCommitteesWitness = getSyncCommitteesWitness(ForkName.altair, stateAltair);
    const currentSyncCommitteeBranch = [syncCommitteesWitness.nextSyncCommitteeRoot, ...syncCommitteesWitness.witness];

    expect(syncCommitteesWitness.witness.length).toBe(NUM_WITNESS);
    expect(
      verifyMerkleBranch(
        ssz.altair.SyncCommittee.hashTreeRoot(currentSyncCommittee),
        currentSyncCommitteeBranch,
        ...fromGindex(CURRENT_SYNC_COMMITTEE_GINDEX),
        stateRootAltair
      )
    ).toBe(true);
  });

  it("nextSyncCommittee proof altair", () => {
    const syncCommitteesWitness = getSyncCommitteesWitness(ForkName.altair, stateAltair);
    const nextSyncCommitteeBranch = getNextSyncCommitteeBranch(syncCommitteesWitness);

    expect(syncCommitteesWitness.witness.length).toBe(NUM_WITNESS);
    expect(
      verifyMerkleBranch(
        ssz.altair.SyncCommittee.hashTreeRoot(nextSyncCommittee),
        nextSyncCommitteeBranch,
        ...fromGindex(NEXT_SYNC_COMMITTEE_GINDEX),
        stateRootAltair
      )
    ).toBe(true);
  });

  it("SyncCommittees proof electra", () => {
    const syncCommitteesWitness = getSyncCommitteesWitness(ForkName.electra, stateElectra);
    const syncCommitteesLeaf = hash(
      syncCommitteesWitness.currentSyncCommitteeRoot,
      syncCommitteesWitness.nextSyncCommitteeRoot
    );

    expect(syncCommitteesWitness.witness.length).toBe(NUM_WITNESS_ELECTRA);
    expect(
      verifyMerkleBranch(
        syncCommitteesLeaf,
        syncCommitteesWitness.witness,
        ...fromGindex(syncCommitteesGindexElectra),
        stateRootElectra
      )
    ).toBe(true);
  });

  it("currentSyncCommittee proof electra", () => {
    const syncCommitteesWitness = getSyncCommitteesWitness(ForkName.electra, stateElectra);
    const currentSyncCommitteeBranch = [syncCommitteesWitness.nextSyncCommitteeRoot, ...syncCommitteesWitness.witness];

    expect(syncCommitteesWitness.witness.length).toBe(NUM_WITNESS_ELECTRA);
    expect(
      verifyMerkleBranch(
        ssz.altair.SyncCommittee.hashTreeRoot(currentSyncCommittee),
        currentSyncCommitteeBranch,
        ...fromGindex(CURRENT_SYNC_COMMITTEE_GINDEX_ELECTRA),
        stateRootElectra
      )
    ).toBe(true);
  });

  it("nextSyncCommittee proof electra", () => {
    const syncCommitteesWitness = getSyncCommitteesWitness(ForkName.electra, stateElectra);
    const nextSyncCommitteeBranch = getNextSyncCommitteeBranch(syncCommitteesWitness);

    expect(
      verifyMerkleBranch(
        ssz.altair.SyncCommittee.hashTreeRoot(nextSyncCommittee),
        nextSyncCommitteeBranch,
        ...fromGindex(NEXT_SYNC_COMMITTEE_GINDEX_ELECTRA),
        stateRootElectra
      )
    ).toBe(true);
  });

  it("getSyncCommitteesWitness returns correct number of witness altair", () => {
    const syncCommitteesWitness = getSyncCommitteesWitness(ForkName.altair, stateAltair);

    expect(syncCommitteesWitness.witness.length).toBe(NUM_WITNESS);
  });

  it("getSyncCommitteesWitness returns correct number of witness electra", () => {
    const syncCommitteesWitness = getSyncCommitteesWitness(ForkName.electra, stateElectra);

    expect(syncCommitteesWitness.witness.length).toBe(NUM_WITNESS_ELECTRA);
  });

  it("currentSyncCommittee proof gloas", () => {
    const syncCommitteesWitness = getSyncCommitteesWitness(ForkName.gloas, stateGloas);
    const currentSyncCommitteeBranch = getCurrentSyncCommitteeBranch(syncCommitteesWitness);

    expect(syncCommitteesWitness.witness.length).toBe(0);
    expect(
      verifyMerkleBranch(
        ssz.altair.SyncCommittee.hashTreeRoot(currentSyncCommittee),
        currentSyncCommitteeBranch,
        ...fromGindex(CURRENT_SYNC_COMMITTEE_GINDEX_GLOAS),
        stateRootGloas
      )
    ).toBe(true);
  });

  it("nextSyncCommittee proof gloas", () => {
    const syncCommitteesWitness = getSyncCommitteesWitness(ForkName.gloas, stateGloas);
    const nextSyncCommitteeBranch = getNextSyncCommitteeBranch(syncCommitteesWitness);

    expect(syncCommitteesWitness.witness.length).toBe(0);
    expect(
      verifyMerkleBranch(
        ssz.altair.SyncCommittee.hashTreeRoot(nextSyncCommittee),
        nextSyncCommitteeBranch,
        ...fromGindex(NEXT_SYNC_COMMITTEE_GINDEX_GLOAS),
        stateRootGloas
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
