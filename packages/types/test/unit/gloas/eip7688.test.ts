import {describe, expect, it} from "vitest";
import {
  ProgressiveByteListType,
  ProgressiveContainerType,
  ProgressiveListBasicType,
  ProgressiveListCompositeType,
} from "@chainsafe/ssz";
import {ssz} from "../../../src/index.js";

describe("Gloas EIP-7688 SSZ types", () => {
  it("uses progressive containers and lists for modified Gloas containers", () => {
    expect(ssz.gloas.Attestation).toBeInstanceOf(ProgressiveContainerType);
    expect(ssz.gloas.IndexedAttestation).toBeInstanceOf(ProgressiveContainerType);
    expect(ssz.gloas.BeaconBlockBody).toBeInstanceOf(ProgressiveContainerType);
    expect(ssz.gloas.ExecutionPayload).toBeInstanceOf(ProgressiveContainerType);
    expect(ssz.gloas.ExecutionRequests).toBeInstanceOf(ProgressiveContainerType);
    expect(ssz.gloas.BeaconState).toBeInstanceOf(ProgressiveContainerType);
    expect(ssz.gloas.ExecutionPayloadBid).toBeInstanceOf(ProgressiveContainerType);
    expect(ssz.gloas.ExecutionPayloadEnvelope).toBeInstanceOf(ProgressiveContainerType);
    expect(ssz.gloas.PayloadAttestation).toBeInstanceOf(ProgressiveContainerType);
    expect(ssz.gloas.IndexedPayloadAttestation).toBeInstanceOf(ProgressiveContainerType);

    expect(ssz.gloas.AttestingIndices).toBeInstanceOf(ProgressiveListBasicType);
    expect(ssz.gloas.Transactions).toBeInstanceOf(ProgressiveListCompositeType);
    expect(ssz.gloas.Withdrawals).toBeInstanceOf(ProgressiveListCompositeType);
    expect(ssz.gloas.BlobKzgCommitments).toBeInstanceOf(ProgressiveListCompositeType);
    expect(ssz.gloas.DataColumn).toBeInstanceOf(ProgressiveListCompositeType);
    expect(ssz.gloas.BuilderDepositRequests).toBeInstanceOf(ProgressiveListCompositeType);
    expect(ssz.gloas.BuilderExitRequests).toBeInstanceOf(ProgressiveListCompositeType);
  });

  it("round-trips default Gloas top-level containers through progressive serialization", () => {
    // Guards against progressive-container offset mismatches on deserialization
    // (e.g. the "First offset must equal to fixedEnd" genesis-load failure).
    for (const type of [ssz.gloas.BeaconState, ssz.gloas.SignedBeaconBlock, ssz.gloas.SignedExecutionPayloadEnvelope]) {
      const serialized = type.serialize(type.defaultValue());
      expect(type.deserialize(serialized)).toEqual(type.defaultValue());
    }
  });

  it("keeps byte-list values while using progressive merkleization", () => {
    expect(ssz.gloas.Transaction).toBeInstanceOf(ProgressiveByteListType);
    expect(ssz.gloas.BlockAccessList).toBeInstanceOf(ProgressiveByteListType);

    const transaction = Uint8Array.from([1, 2, 3, 4]);
    const serialized = ssz.gloas.Transaction.serialize(transaction);
    expect(ssz.gloas.Transaction.deserialize(serialized)).toEqual(transaction);

    const blockAccessList = Uint8Array.from([5, 6, 7, 8]);
    const blockAccessListSerialized = ssz.gloas.BlockAccessList.serialize(blockAccessList);
    expect(ssz.gloas.BlockAccessList.deserialize(blockAccessListSerialized)).toEqual(blockAccessList);
  });

  it("keeps Lodestar DU list helpers on upstream progressive lists", () => {
    const validator = ssz.phase0.Validator.defaultValue();
    const validators = ssz.gloas.Validators.toViewDU([validator]);
    expect(validators.getReadonly(0).toValue()).toEqual(validator);
    expect(validators.getAllReadonlyValues()).toEqual([validator]);
    expect(validators.sliceTo(0).length).toBe(1);
    expect(validators.sliceFrom(1).length).toBe(0);

    const balances = ssz.gloas.Balances.toViewDU([1, 2, 3]);
    expect(balances.sliceTo(1).getAll()).toEqual([1, 2]);
    expect(balances.sliceFrom(1).getAll()).toEqual([2, 3]);
  });

  it("matches Gloas light-client state gindices from EIP-7688 progressive containers", () => {
    expect(Number(ssz.gloas.BeaconState.getPathInfo(["finalizedCheckpoint", "root"]).gindex)).toBe(735);
    expect(Number(ssz.gloas.BeaconState.getPathInfo(["currentSyncCommittee"]).gindex)).toBe(2945);
    expect(Number(ssz.gloas.BeaconState.getPathInfo(["nextSyncCommittee"]).gindex)).toBe(2946);
  });
});
