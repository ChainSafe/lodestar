import {describe, expect, it} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {FAR_FUTURE_EPOCH, MIN_SEED_LOOKAHEAD, PAYLOAD_STATUS_FULL, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "../../../src/index.js";

/**
 * Hash tree roots computed with the pyspec of ethereum/consensus-specs branch `decoupled-consensus` at
 * 5d5dd314e (27 Oct 2026), minimal preset, with the values built below. See the DC status notes for the script.
 * They pin the wire format of the EIP8453 types to the spec.
 */
const PYSPEC = {
  BeaconBlockBody: "0x2c32dd16d0820365d808eedd807229cb98bcb38e7cd079d9fd48f72b57cdd321",
  BeaconState: "0x777d4acb6f982a44470b76f541333e07971f9b56862158e6d6b957fd945ff89f",
  Attestation: "0x575816a31fdc0d91b51abeb96e538f0eb8f1fc24eca13103bab152ed46f49ab1",
  HeadVote: "0x6f394a8bd076381963454c443a42ecaca6c3c1c3cd90c44003476d93e6923620",
  IndexedAttestation: "0xf77dcb27acd364745ad7aa4b88d4c96d95f13f399328466eb657329fa2fd5044",
  stateNontrivial: "0xdce761d05aaf54940cd6589a865002b7959b98fc83d50fb6079b1e3c57be90c7",
  bodyNontrivial: "0x53576d5014d057ebeaa3476b50402a52e2af16e58deaf07aa76cd30af7e8e741",
  attNontrivial: "0x82ae81caf26eb68d76a6367e9288e4262730c78e413dec3bb17463c3a6a367c1",
  headVoteNontrivial: "0xdb7ada1616d15c2cc3469232b4b78cfa445fdea821d964808979a18c02d8adc1",
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
    headVote.voterIndices = [1, 3];
    headVote.data = {slot: 5, beaconBlockRoot: fill(0x11, 32), payloadStatus: PAYLOAD_STATUS_FULL};
    headVote.signature = fill(0x22, 96);
    expect(toHex(ssz.eip8453.HeadVote.hashTreeRoot(headVote))).toBe(PYSPEC.headVoteNontrivial);
    body.headVotes = [headVote];
    body.headVoteSupport = [BitArray.fromBoolArray([true, false])];
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
    state.headVoteCommitteeWindow[5][1] = 3;
    state.headVoteCommitteeWindow[17][0] = 2;
    expect(state.headVoteParticipation.length).toBe(2 * SLOTS_PER_EPOCH);
    expect(state.headVoteCommitteeWindow.length).toBe((MIN_SEED_LOOKAHEAD + 2) * SLOTS_PER_EPOCH);
    expect(toHex(ssz.eip8453.BeaconState.hashTreeRoot(state))).toBe(PYSPEC.stateNontrivial);
  });
});
