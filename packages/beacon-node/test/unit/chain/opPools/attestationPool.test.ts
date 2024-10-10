import {fromHexString, toHexString} from "@chainsafe/ssz";
import {describe, it, expect, beforeEach, vi} from "vitest";
import {GENESIS_SLOT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";
import {AttestationPool} from "../../../../src/chain/opPools/attestationPool.js";
import {getMockedClock} from "../../../mocks/clock.js";

/** Valid signature of random data to prevent BLS errors */
export const validSignature = fromHexString(
  "0xb2afb700f6c561ce5e1b4fedaec9d7c06b822d38c720cf588adfda748860a940adf51634b6788f298c552de40183b5a203b2bbe8b7dd147f0bb5bc97080a12efbb631c8888cb31a99cc4706eb3711865b8ea818c10126e4d818b542e9dbf9ae8"
);

describe("AttestationPool", function () {
  const config = createChainForkConfig({
    ...defaultChainConfig,
    ELECTRA_FORK_EPOCH: 5,
    DENEB_FORK_EPOCH: 4,
    CAPELLA_FORK_EPOCH: 3,
    BELLATRIX_FORK_EPOCH: 2,
    ALTAIR_FORK_EPOCH: 1,
  });
  const clockStub = getMockedClock();
  vi.spyOn(clockStub, "secFromSlot").mockReturnValue(0);

  const cutOffSecFromSlot = (2 / 3) * config.SECONDS_PER_SLOT;

  // Mock attestations
  const electraAttestationData = {
    ...ssz.phase0.AttestationData.defaultValue(),
    slot: config.ELECTRA_FORK_EPOCH * SLOTS_PER_EPOCH,
  };
  const electraAttestation = {
    ...ssz.electra.Attestation.defaultValue(),
    data: electraAttestationData,
    signature: validSignature,
  };
  const phase0AttestationData = {...ssz.phase0.AttestationData.defaultValue(), slot: GENESIS_SLOT};
  const phase0Attestation = {
    ...ssz.phase0.Attestation.defaultValue(),
    data: phase0AttestationData,
    signature: validSignature,
  };

  let pool: AttestationPool;

  beforeEach(() => {
    pool = new AttestationPool(config, clockStub, cutOffSecFromSlot);
  });

  it("add correct electra attestation", () => {
    const committeeIndex = 0;
    const attDataRootHex = toHexString(ssz.phase0.AttestationData.hashTreeRoot(electraAttestation.data));
    const outcome = pool.add(committeeIndex, electraAttestation, attDataRootHex);

    expect(outcome).equal(InsertOutcome.NewData);
    expect(pool.getAggregate(electraAttestationData.slot, committeeIndex, attDataRootHex)).toEqual(electraAttestation);
  });

  it("add correct phase0 attestation", () => {
    const committeeIndex = null;
    const attDataRootHex = toHexString(ssz.phase0.AttestationData.hashTreeRoot(phase0Attestation.data));
    const outcome = pool.add(committeeIndex, phase0Attestation, attDataRootHex);

    expect(outcome).equal(InsertOutcome.NewData);
    expect(pool.getAggregate(phase0AttestationData.slot, committeeIndex, attDataRootHex)).toEqual(phase0Attestation);
    expect(pool.getAggregate(phase0AttestationData.slot, 10, attDataRootHex)).toEqual(phase0Attestation);
    expect(pool.getAggregate(phase0AttestationData.slot, 42, attDataRootHex)).toEqual(phase0Attestation);
    expect(pool.getAggregate(phase0AttestationData.slot, null, attDataRootHex)).toEqual(phase0Attestation);
  });

  it("add electra attestation without committee index", () => {
    const committeeIndex = null;
    const attDataRootHex = toHexString(ssz.phase0.AttestationData.hashTreeRoot(electraAttestation.data));

    expect(() => pool.add(committeeIndex, electraAttestation, attDataRootHex)).toThrow();
    expect(pool.getAggregate(electraAttestationData.slot, committeeIndex, attDataRootHex)).toBeNull();
  });

  it("add phase0 attestation with committee index", () => {
    const committeeIndex = 0;
    const attDataRootHex = toHexString(ssz.phase0.AttestationData.hashTreeRoot(phase0Attestation.data));
    const outcome = pool.add(committeeIndex, phase0Attestation, attDataRootHex);

    expect(outcome).equal(InsertOutcome.NewData);
    expect(pool.getAggregate(phase0AttestationData.slot, committeeIndex, attDataRootHex)).toEqual(phase0Attestation);
    expect(pool.getAggregate(phase0AttestationData.slot, 123, attDataRootHex)).toEqual(phase0Attestation);
    expect(pool.getAggregate(phase0AttestationData.slot, 456, attDataRootHex)).toEqual(phase0Attestation);
    expect(pool.getAggregate(phase0AttestationData.slot, null, attDataRootHex)).toEqual(phase0Attestation);
  });

  it("add electra attestation with phase0 slot", () => {
    const electraAttestationDataWithPhase0Slot = {...ssz.phase0.AttestationData.defaultValue(), slot: GENESIS_SLOT};
    const attestation = {
      ...ssz.electra.Attestation.defaultValue(),
      data: electraAttestationDataWithPhase0Slot,
      signature: validSignature,
    };
    const attDataRootHex = toHexString(ssz.phase0.AttestationData.hashTreeRoot(electraAttestationDataWithPhase0Slot));

    expect(() => pool.add(0, attestation, attDataRootHex)).toThrow();
  });

  it("add phase0 attestation with electra slot", () => {
    const phase0AttestationDataWithElectraSlot = {
      ...ssz.phase0.AttestationData.defaultValue(),
      slot: config.ELECTRA_FORK_EPOCH * SLOTS_PER_EPOCH,
    };
    const attestation = {
      ...ssz.phase0.Attestation.defaultValue(),
      data: phase0AttestationDataWithElectraSlot,
      signature: validSignature,
    };
    const attDataRootHex = toHexString(ssz.phase0.AttestationData.hashTreeRoot(phase0AttestationDataWithElectraSlot));

    expect(() => pool.add(0, attestation, attDataRootHex)).toThrow();
  });
});
