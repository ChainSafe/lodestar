import {describe, expect, it} from "vitest";
import {
  ByteListType,
  ProgressiveByteListType,
  ProgressiveContainerType,
  ProgressiveListBasicType,
} from "@chainsafe/ssz";
import {MAX_PROOF_SIZE, MAX_SIGNED_EXECUTION_PROOF_ENVELOPE_SIZE, STATELESS_INPUT_SCHEMA_ID} from "@lodestar/params";
import {ssz} from "../../../src/index.js";

describe("EIP-8025 SSZ types", () => {
  it("uses progressive ProofData bounded by MAX_PROOF_SIZE", () => {
    expect(ssz.eip8025.ProofData).toBeInstanceOf(ProgressiveByteListType);
    expect(ssz.eip8025.ProofData.limitBytes).toBe(MAX_PROOF_SIZE);
  });

  it.each([0, 1, 32, 33, 160, 161])("merkleizes ProofData as ProgressiveList[Byte] with %i bytes", (length) => {
    const proofData = new Uint8Array(length).fill(0xab);
    const progressiveList = new ProgressiveListBasicType(ssz.Uint8);
    const boundedList = new ByteListType(MAX_PROOF_SIZE);

    expect(ssz.eip8025.ProofData.hashTreeRoot(proofData)).toEqual(progressiveList.hashTreeRoot(Array.from(proofData)));
    expect(ssz.eip8025.ProofData.hashTreeRoot(proofData)).not.toEqual(boundedList.hashTreeRoot(proofData));
    expect(ssz.eip8025.ProofData.deserialize(ssz.eip8025.ProofData.serialize(proofData))).toEqual(proofData);
  });

  it("rejects ProofData over MAX_PROOF_SIZE", () => {
    const proofData = new Uint8Array(MAX_PROOF_SIZE + 1);
    expect(() => ssz.eip8025.ProofData.deserialize(proofData)).toThrow();
    expect(() => ssz.eip8025.ProofData.fromJson(ssz.eip8025.ProofData.toJson(proofData))).toThrow();
  });

  it("serializes PublicInput as the 43 bytes the proof systems commit to", () => {
    expect(ssz.eip8025.PublicInput).toBeInstanceOf(ProgressiveContainerType);
    expect(ssz.eip8025.PublicInput.fixedSize).toBe(43);

    const bytes = ssz.eip8025.PublicInput.serialize({
      newPayloadRequestRoot: Buffer.alloc(32, 0xab),
      successfulValidation: true,
      chainId: 1,
      schemaId: STATELESS_INPUT_SCHEMA_ID,
    });
    expect(bytes).toHaveLength(43);
    expect(Buffer.from(bytes.subarray(0, 32))).toEqual(Buffer.alloc(32, 0xab));
    expect(bytes[32]).toBe(1);
    expect(Buffer.from(bytes.subarray(33, 41)).readBigUInt64LE()).toBe(1n);
    expect(Buffer.from(bytes.subarray(41, 43)).readUInt16LE()).toBe(0x1501);
  });

  it("caps SignedExecutionProofEnvelope at MAX_SIGNED_EXECUTION_PROOF_ENVELOPE_SIZE", () => {
    expect(ssz.eip8025.SignedExecutionProofEnvelope.maxSize).toBe(MAX_SIGNED_EXECUTION_PROOF_ENVELOPE_SIZE);
  });

  it("round-trips eth2 JSON", () => {
    const value = ssz.eip8025.SignedExecutionProofEnvelope.defaultValue();
    value.message.proofData = Uint8Array.from([1, 2, 3]);
    value.message.proofType = 2;
    value.validatorIndex = 7;

    const json = ssz.eip8025.SignedExecutionProofEnvelope.toJson(value);
    expect(json).toMatchObject({validator_index: "7", message: {proof_data: "0x010203", proof_type: "2"}});
    expect(ssz.eip8025.SignedExecutionProofEnvelope.fromJson(json)).toEqual(value);
  });
});
