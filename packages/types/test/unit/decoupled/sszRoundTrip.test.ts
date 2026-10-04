import {describe, expect, it} from "vitest";
import {BitArray, Type} from "@chainsafe/ssz";
import {EMPTY_HEIGHT, PAYLOAD_STATUS_FULL} from "@lodestar/params";
import {ssz} from "../../../src/index.js";

const dc = ssz.decoupled;

function roundTrip<T>(type: Type<T>, value: T): void {
  const bytes = type.serialize(value);
  const back = type.deserialize(bytes);
  expect(type.equals(back, value)).toBe(true);
  expect(type.hashTreeRoot(back)).toEqual(type.hashTreeRoot(value));
  expect(type.equals(type.fromJson(type.toJson(value)), value)).toBe(true);
}

function root(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

const heightPair = {height: 7, root: root(0xaa)};
const attestationData2 = {
  round: 12,
  finalizePair: {height: 6, root: root(0xbb)},
  targetPair: heightPair,
};

describe("decoupled ssz round trips", () => {
  it("HeightPair", () => {
    roundTrip(dc.HeightPair, heightPair);
  });

  it("HeightPair with EMPTY_HEIGHT", () => {
    const value = {height: EMPTY_HEIGHT, root: root(0)};
    roundTrip(dc.HeightPair, value);
    expect(dc.HeightPair.serialize(value).subarray(0, 8)).toEqual(new Uint8Array(8).fill(0xff));
  });

  it("AttestationData2", () => {
    roundTrip(dc.AttestationData2, attestationData2);
  });

  it("IndexedAttestation2", () => {
    roundTrip(dc.IndexedAttestation2, {
      attestingIndices: [1, 5, 9],
      data: attestationData2,
      signature: Buffer.alloc(96, 1),
    });
  });

  it("AttesterSlashing2", () => {
    const attestation = {attestingIndices: [2, 3], data: attestationData2, signature: Buffer.alloc(96, 2)};
    roundTrip(dc.AttesterSlashing2, {attestation1: attestation, attestation2: attestation});
  });

  it("AvailableChainAttestationData", () => {
    roundTrip(dc.AvailableChainAttestationData, {root: root(1), slot: 33, payloadStatus: PAYLOAD_STATUS_FULL});
  });

  it("AvailableChainAttestation", () => {
    roundTrip(dc.AvailableChainAttestation, {
      attestingIndices: [0, 4],
      data: {root: root(2), slot: 34, payloadStatus: PAYLOAD_STATUS_FULL},
      signature: Buffer.alloc(96, 3),
    });
  });

  it("AvailableChainCommittee and indices", () => {
    const committee = dc.AvailableChainCommittee.defaultValue();
    committee[0] = 42;
    roundTrip(dc.AvailableChainCommittee, committee);
    roundTrip(dc.AvailableChainCommitteeIndices, [1, 2, 3]);
  });

  it("AvailableChainParticipation", () => {
    const participation = dc.AvailableChainParticipation.defaultValue();
    participation[1] = [7, 8];
    roundTrip(dc.AvailableChainParticipation, participation);
  });

  it("Attestation keeps the legacy data chunk as a gap", () => {
    const attestation = dc.Attestation.defaultValue();
    attestation.aggregationBits = BitArray.fromBoolArray([true, false, true]);
    attestation.committeeBits.set(3, true);
    attestation.data = attestationData2;
    roundTrip(dc.Attestation, attestation);

    expect(dc.Attestation.getPropertyGindex("aggregationBits")).toEqual(
      dc.IndexedAttestation2.getPropertyGindex("attestingIndices")
    );
    expect(dc.Attestation.getPropertyGindex("signature")).not.toEqual(ssz.gloas.Attestation.getPropertyGindex("data"));
    expect(dc.Attestation.getPropertyGindex("signature")).toEqual(ssz.gloas.Attestation.getPropertyGindex("signature"));
    expect(dc.Attestation.getPropertyGindex("committeeBits")).toEqual(
      ssz.gloas.Attestation.getPropertyGindex("committeeBits")
    );
  });

  it("BeaconBlockBody", () => {
    const body = dc.BeaconBlockBody.defaultValue();
    body.attestations.push(dc.Attestation.defaultValue());
    body.availableChainAttestations.push(dc.AvailableChainAttestation.defaultValue());
    body.attesterSlashings2.push(dc.AttesterSlashing2.defaultValue());
    roundTrip(dc.BeaconBlockBody, body);
    expect(dc.BeaconBlockBody.activeFields.getTrueBitIndexes().length).toBe(15);
  });

  it("SignedBeaconBlock", () => {
    roundTrip(dc.SignedBeaconBlock, dc.SignedBeaconBlock.defaultValue());
  });

  it("BeaconState", () => {
    const state = dc.BeaconState.defaultValue();
    state.targetPair = heightPair;
    state.justifiedPair = {height: 6, root: root(0xcc)};
    state.finalizedPair = {height: 5, root: root(0xdd)};
    state.targetSlot = 50;
    state.justifiedSlot = 40;
    state.finalizedSlot = 30;
    state.heightParticipation.push(0b11);
    state.currentRoundParticipation.push(0b1);
    state.previousRoundParticipation.push(0b100);
    state.builderPaymentParticipation[0] = [1];
    roundTrip(dc.BeaconState, state);
    expect(dc.BeaconState.activeFields.getTrueBitIndexes().length).toBe(56);
  });

  it("BeaconState view round trip", () => {
    const state = dc.BeaconState.defaultValue();
    state.targetPair = heightPair;
    const view = dc.BeaconState.toViewDU(state);
    view.targetSlot = 9;
    view.commit();
    expect(view.toValue().targetSlot).toBe(9);
    expect(view.targetPair.height).toBe(7);
  });
});
