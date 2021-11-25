import {SYNC_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";
import {allForks, altair, ssz} from "@chainsafe/lodestar-types";
import {verifyMerkleBranch} from "@chainsafe/lodestar-utils";
import {hash} from "@chainsafe/persistent-merkle-tree";
import {toHexString, TreeBacked} from "@chainsafe/ssz";
import {expect} from "chai";
import {
  GenesisData,
  getGenesisWitness,
  getNextSyncCommitteeBranch,
  getSyncCommitteesWitness,
} from "../../../../src/chain/lightClient/proofs";
import {GenesisWitness} from "../../../../src/chain/lightClient/types";

/** First field, 2**5 + 0 */
const genesisTimeGindex = BigInt(32);
/** Parent of first field, 2**4 + 0 */
const genesisGindex = 16;
const currentSyncCommitteeGindex = 54;
const nextSyncCommitteeGindex = 55;
const syncCommitteesGindex = 27;

describe("chain / lightclient / proof", () => {
  let state: TreeBacked<altair.BeaconState>;
  let stateRoot: Uint8Array;

  const genesisTime = 15000000;
  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const currentSyncCommittee = fillSyncCommittee(Buffer.alloc(48, 0xbb));
  const nextSyncCommittee = fillSyncCommittee(Buffer.alloc(48, 0xcc));

  before("random state", () => {
    state = ssz.altair.BeaconState.defaultTreeBacked();
    state.genesisTime = genesisTime;
    state.genesisValidatorsRoot = genesisValidatorsRoot;
    state.currentSyncCommittee = currentSyncCommittee;
    state.nextSyncCommittee = nextSyncCommittee;
    stateRoot = ssz.altair.BeaconState.hashTreeRoot(state);
  });

  it("genesisWitness sanity checks", () => {
    const genesisTimeLeaf = Buffer.alloc(32, 0);
    genesisTimeLeaf.writeInt32LE(genesisTime, 0);

    // Sanity check, ensure the genesisTimeLeaf is correct
    expect(toHexString(genesisTimeLeaf)).to.equal(
      toHexString(state.tree.getNode(genesisTimeGindex).root),
      "genesisTimeLeaf does not match value in tree"
    );

    const genesisLeaf = hash(genesisTimeLeaf, genesisValidatorsRoot);
    expect(toHexString(genesisLeaf)).to.equal(
      toHexString(state.tree.getNode(BigInt(genesisGindex)).root),
      "genesisLeaf does not match value in tree"
    );
  });

  it("genesisWitness", () => {
    const genesisWitness = getGenesisWitness(state as TreeBacked<allForks.BeaconState>);
    const genesisData: GenesisData = {genesisTime, genesisValidatorsRoot};

    expect(isValidGenesisProof(genesisData, genesisWitness, stateRoot)).to.equal(true, "Invalid proof");
  });

  it("SyncCommittees proof", () => {
    const syncCommitteesWitness = getSyncCommitteesWitness(state as TreeBacked<allForks.BeaconState>);
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
    const syncCommitteesWitness = getSyncCommitteesWitness(state as TreeBacked<allForks.BeaconState>);
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
    const syncCommitteesWitness = getSyncCommitteesWitness(state as TreeBacked<allForks.BeaconState>);
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

/**
 * Example of a client side validation function for genesis proof
 */
function isValidGenesisProof(genesisData: GenesisData, genesisWitness: GenesisWitness, stateRoot: Uint8Array): boolean {
  const genesisTimeLeaf = Buffer.alloc(32, 0);
  genesisTimeLeaf.writeInt32LE(genesisData.genesisTime, 0);

  const genesisLeaf = hash(genesisTimeLeaf, genesisData.genesisValidatorsRoot);

  return verifyMerkleBranch(genesisLeaf, genesisWitness, ...fromGindex(genesisGindex), stateRoot);
}

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
