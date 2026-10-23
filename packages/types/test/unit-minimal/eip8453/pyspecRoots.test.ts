import {describe, expect, it} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {FAR_FUTURE_EPOCH, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "../../../src/index.js";

/**
 * Hash tree roots computed with the pyspec of ethereum/consensus-specs branch `decoupled-consensus` at
 * d19f81cf6 (22 Oct 2026), minimal preset, with the values built below. See the DC status notes for the script.
 * They pin the wire format of the EIP8453 types to the spec.
 */
const PYSPEC = {
  BeaconBlockBody: "0x2c32dd16d0820365d808eedd807229cb98bcb38e7cd079d9fd48f72b57cdd321",
  BeaconState: "0x88fce4e7777099dd92c5192b97ba7e04989d80d0a2016f32d9cd7e46102607c0",
  Attestation: "0x575816a31fdc0d91b51abeb96e538f0eb8f1fc24eca13103bab152ed46f49ab1",
  HeadVote: "0x89f6e5460ec01bfdddc18aa20fe9bc6048ebf854742feb3be84b04979028dd16",
  IndexedAttestation: "0xf77dcb27acd364745ad7aa4b88d4c96d95f13f399328466eb657329fa2fd5044",
  stateNontrivial: "0x3e4e06c1aa07c4c4abe5cdce15c6f1e64b2342044b946f05f140b4ee510e1e8c",
  bodyNontrivial: "0x51c3651b2e98ff7c68f0c6a4b33d17047f82075b832166246542aba405e254aa",
  attNontrivial: "0x82ae81caf26eb68d76a6367e9288e4262730c78e413dec3bb17463c3a6a367c1",
};

const fill = (byte: number, length: number): Uint8Array => new Uint8Array(length).fill(byte);
const toHex = (bytes: Uint8Array): string => `0x${Buffer.from(bytes).toString("hex")}`;

describe("eip8453 hash tree roots match the pyspec (minimal preset)", () => {
  it("default values", () => {
    for (const name of ["BeaconBlockBody", "BeaconState", "Attestation", "HeadVote", "IndexedAttestation"] as const) {
      const type = ssz.eip8453[name];
      expect(toHex(type.hashTreeRoot(type.defaultValue() as never)), name).toBe(PYSPEC[name]);
    }
  });

  it("non-trivial attestation and block body", () => {
    const attestation = ssz.eip8453.Attestation.defaultValue();
    attestation.data = {
      target: {height: 7, root: fill(0xaa, 32)},
      timeout: false,
      finality: {height: 6, root: fill(0xbb, 32)},
    };
    attestation.signature = fill(0x33, 96);
    attestation.epoch = 3;
    attestation.committeeBits.set(2, true);
    attestation.aggregationBits = BitArray.fromBoolArray([true, false, true, false, true]);
    expect(toHex(ssz.eip8453.Attestation.hashTreeRoot(attestation))).toBe(PYSPEC.attNontrivial);

    const body = ssz.eip8453.BeaconBlockBody.defaultValue();
    const headVote = ssz.eip8453.HeadVote.defaultValue();
    headVote.aggregationBits.set(1, true);
    headVote.data = {slot: 5, beaconBlockRoot: fill(0x11, 32)};
    headVote.signature = fill(0x22, 96);
    body.headVotes = [headVote];
    body.headVoteSupportBits = BitArray.fromBoolArray([true]);
    body.attestations = [attestation];
    expect(toHex(ssz.eip8453.BeaconBlockBody.hashTreeRoot(body))).toBe(PYSPEC.bodyNontrivial);
  });

  it("non-trivial state", () => {
    const state = ssz.eip8453.BeaconState.defaultValue();
    for (let i = 0; i < 4; i++) {
      state.validators.push({
        pubkey: fill(i + 1, 48),
        withdrawalCredentials: fill(0, 32),
        effectiveBalance: 32e9,
        slashed: false,
        activationEligibilityEpoch: 0,
        activationEpoch: 0,
        exitEpoch: FAR_FUTURE_EPOCH,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      });
      state.balances.push(32e9);
      state.inactivityScores.push(i);
      state.roundParticipation.push(i % 4);
      state.targetParticipation.push(i % 2 === 0);
      state.progressParticipation.push(true);
    }
    state.targetCheckpoint = {height: 7, root: fill(0xaa, 32)};
    state.justifiedCheckpoint = {height: 6, root: fill(0xbb, 32)};
    state.finalizedCheckpoint = {height: 5, root: fill(0xcc, 32)};
    state.targetSlot = 100;
    state.finalizedSlot = 80;
    state.pendingFinality.push({
      checkpoint: {height: 6, root: fill(0xbb, 32)},
      slot: 90,
      participation: [false, true, false, false],
    });
    state.headVoteParticipation[3].set(2, true);
    expect(state.headVoteParticipation.length).toBe(2 * SLOTS_PER_EPOCH);
    expect(toHex(ssz.eip8453.BeaconState.hashTreeRoot(state))).toBe(PYSPEC.stateNontrivial);
  });
});
