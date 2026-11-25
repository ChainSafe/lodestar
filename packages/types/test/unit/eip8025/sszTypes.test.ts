import {describe, expect, it} from "vitest";
import {ByteListType, ListBasicType, ProgressiveByteListType, ProgressiveContainerType} from "@chainsafe/ssz";
import {MAX_PROOF_SIZE, MAX_SIGNED_EXECUTION_PROOF_ENVELOPE_SIZE, STATELESS_INPUT_SCHEMA_ID} from "@lodestar/params";
import {ssz} from "../../../src/index.js";

describe("EIP-8025 SSZ types", () => {
  it("uses bounded ProofData with MAX_PROOF_SIZE", () => {
    expect(ssz.eip8025.ProofData).toBeInstanceOf(ByteListType);
    expect(ssz.eip8025.ProofData.limitBytes).toBe(MAX_PROOF_SIZE);
  });

  it.each([0, 1, 32, 33, 160, 161])("merkleizes ProofData as List[Byte, MAX_PROOF_SIZE] with %i bytes", (length) => {
    const proofData = new Uint8Array(length).fill(0xab);
    const boundedList = new ListBasicType(ssz.Byte, MAX_PROOF_SIZE);
    const progressiveList = new ProgressiveByteListType();

    expect(ssz.eip8025.ProofData.hashTreeRoot(proofData)).toEqual(boundedList.hashTreeRoot(Array.from(proofData)));
    expect(ssz.eip8025.ProofData.hashTreeRoot(proofData)).not.toEqual(progressiveList.hashTreeRoot(proofData));
    expect(ssz.eip8025.ProofData.deserialize(ssz.eip8025.ProofData.serialize(proofData))).toEqual(proofData);
  });

  it("rejects ProofData over MAX_PROOF_SIZE", () => {
    const proofData = new Uint8Array(MAX_PROOF_SIZE + 1);
    expect(() => ssz.eip8025.ProofData.deserialize(proofData)).toThrow();
    expect(() => ssz.eip8025.ProofData.fromJson(ssz.eip8025.ProofData.toJson(proofData))).toThrow();
  });

  it("serializes PublicInput as a 43-byte SSZ encoding", () => {
    expect(ssz.eip8025.PublicInput).toBeInstanceOf(ProgressiveContainerType);
    expect(ssz.eip8025.PublicInput.fixedSize).toBe(43);

    const bytes = ssz.eip8025.PublicInput.serialize({
      newPayloadRequestRoot: Buffer.alloc(32, 0xab),
      successfulValidation: true,
      chainId: 1n,
      schemaId: STATELESS_INPUT_SCHEMA_ID,
    });
    expect(bytes).toHaveLength(43);
    expect(Buffer.from(bytes.subarray(0, 32))).toEqual(Buffer.alloc(32, 0xab));
    expect(bytes[32]).toBe(1);
    expect(Buffer.from(bytes.subarray(33, 41)).readBigUInt64LE()).toBe(1n);
    expect(Buffer.from(bytes.subarray(41, 43)).readUInt16LE()).toBe(0x1501);
  });

  it.each([9007199254740993n, 2n ** 64n - 1n])("preserves chainId %s through SSZ and JSON round trips", (chainId) => {
    const bytes = ssz.eip8025.PublicInput.serialize(ssz.eip8025.PublicInput.defaultValue());
    bytes.set(ssz.UintBn64.serialize(chainId), 33);

    const publicInput = ssz.eip8025.PublicInput.deserialize(bytes);

    expect(publicInput.chainId).toBe(chainId);
    expect(ssz.eip8025.PublicInput.serialize(publicInput)).toEqual(bytes);

    const json = ssz.eip8025.PublicInput.toJson(publicInput);
    expect(json).toMatchObject({chain_id: chainId.toString()});
    expect(ssz.eip8025.PublicInput.fromJson(json)).toEqual(publicInput);
    expect(ssz.eip8025.PublicInput.hashTreeRoot(ssz.eip8025.PublicInput.fromJson(json))).toEqual(
      ssz.eip8025.PublicInput.hashTreeRoot(publicInput)
    );
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
