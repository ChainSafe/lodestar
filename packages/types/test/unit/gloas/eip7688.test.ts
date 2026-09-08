import {describe, expect, it} from "vitest";
import {
  ProgressiveByteListType,
  ProgressiveContainerType,
  ProgressiveListBasicType,
  ProgressiveListCompositeType,
} from "@chainsafe/ssz";
import {
  MAX_ATTESTATIONS_ELECTRA,
  MAX_ATTESTER_SLASHINGS_ELECTRA,
  MAX_BLS_TO_EXECUTION_CHANGES,
  MAX_BUILDER_DEPOSIT_REQUESTS_PER_PAYLOAD,
  MAX_BUILDER_EXIT_REQUESTS_PER_PAYLOAD,
  MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD,
  MAX_PAYLOAD_ATTESTATIONS,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS,
  MAX_WITHDRAWALS_PER_PAYLOAD,
  MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD,
} from "@lodestar/params";
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
    // Typed per-container via a generic helper so serialize/deserialize bind to the same
    // value type; a heterogeneous array would collapse to a union and fail type-checking.
    function assertRoundTrips<V>(type: {
      defaultValue(): V;
      serialize(value: V): Uint8Array;
      deserialize(data: Uint8Array): V;
    }): void {
      const value = type.defaultValue();
      expect(type.deserialize(type.serialize(value))).toEqual(value);
    }

    assertRoundTrips(ssz.gloas.BeaconState);
    assertRoundTrips(ssz.gloas.SignedBeaconBlock);
    assertRoundTrips(ssz.gloas.SignedExecutionPayloadEnvelope);
    assertRoundTrips(ssz.gloas.SignedExecutionPayloadBid);
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

  it("enforces Gloas progressive list limits on deserialization and JSON parsing", () => {
    function assertLimit<Value>(
      type: {
        readonly elementType: {defaultValue(): Value};
        readonly limit: number;
        readonly typeName: string;
        serialize(value: Value[]): Uint8Array;
        deserialize(data: Uint8Array): Value[];
        toJson(value: Value[]): unknown;
        fromJson(json: unknown): Value[];
      },
      limit: number
    ): void {
      expect(type.limit, type.typeName).toBe(limit);

      const value = Array.from({length: limit + 1}, () => type.elementType.defaultValue());
      expect(() => type.deserialize(type.serialize(value))).toThrow(
        `Invalid list length ${limit + 1} over limit ${limit}`
      );
      expect(() => type.fromJson(type.toJson(value))).toThrow(`Invalid list length ${limit + 1} over limit ${limit}`);
    }

    assertLimit(ssz.gloas.Withdrawals, MAX_WITHDRAWALS_PER_PAYLOAD);
    assertLimit(ssz.gloas.WithdrawalRequests, MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD);
    assertLimit(ssz.gloas.ConsolidationRequests, MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD);
    assertLimit(ssz.gloas.BuilderDepositRequests, MAX_BUILDER_DEPOSIT_REQUESTS_PER_PAYLOAD);
    assertLimit(ssz.gloas.BuilderExitRequests, MAX_BUILDER_EXIT_REQUESTS_PER_PAYLOAD);
    assertLimit(ssz.gloas.ProposerSlashings, MAX_PROPOSER_SLASHINGS);
    assertLimit(ssz.gloas.AttesterSlashings, MAX_ATTESTER_SLASHINGS_ELECTRA);
    assertLimit(ssz.gloas.Attestations, MAX_ATTESTATIONS_ELECTRA);
    assertLimit(ssz.gloas.VoluntaryExits, MAX_VOLUNTARY_EXITS);
    assertLimit(ssz.gloas.BlsToExecutionChanges, MAX_BLS_TO_EXECUTION_CHANGES);
    assertLimit(ssz.gloas.PayloadAttestations, MAX_PAYLOAD_ATTESTATIONS);
  });

  it("matches Gloas light-client state gindices from EIP-7688 progressive containers", () => {
    expect(Number(ssz.gloas.BeaconState.getPathInfo(["finalizedCheckpoint", "root"]).gindex)).toBe(735);
    expect(Number(ssz.gloas.BeaconState.getPathInfo(["currentSyncCommittee"]).gindex)).toBe(2945);
    expect(Number(ssz.gloas.BeaconState.getPathInfo(["nextSyncCommittee"]).gindex)).toBe(2946);
  });
});
