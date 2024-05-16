import {describe, it, expect} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {allForks, deneb, Epoch, isElectraAttestation, phase0, RootHex, Slot, ssz} from "@lodestar/types";
import {fromHex, toHex} from "@lodestar/utils";
import {ForkName, MAX_COMMITTEES_PER_SLOT} from "@lodestar/params";
import {
  getSeenAttDataKeyPhase0,
  getAttDataBase64FromSignedAggregateAndProofSerialized,
  getAggregationBitsFromAttestationSerialized,
  getBlockRootFromAttestationSerialized,
  getBlockRootFromSignedAggregateAndProofSerialized,
  getSlotFromAttestationSerialized,
  getSlotFromSignedAggregateAndProofSerialized,
  getSignatureFromAttestationSerialized,
  getSlotFromSignedBeaconBlockSerialized,
  getSlotFromBlobSidecarSerialized,
  getCommitteeBitsFromAttestationSerialized,
} from "../../../src/util/sszBytes.js";

describe("attestation SSZ serialized picking", () => {
  const testCases: allForks.Attestation[] = [
    ssz.phase0.Attestation.defaultValue(),
    attestationFromValues(
      4_000_000,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      200_00,
      "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeffffffffffffffffffffffffffffffff"
    ),
    ssz.electra.Attestation.defaultValue(),
    {
      ...attestationFromValues(
        4_000_000,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        200_00,
        "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeffffffffffffffffffffffffffffffff"
      ),
      committeeBits: BitArray.fromSingleBit(MAX_COMMITTEES_PER_SLOT, 3),
    },
  ];

  for (const [i, attestation] of testCases.entries()) {
    it(`attestation ${i}`, () => {
      const isElectra = isElectraAttestation(attestation);
      const bytes = isElectra
        ? ssz.electra.Attestation.serialize(attestation)
        : ssz.phase0.Attestation.serialize(attestation);

      expect(getSlotFromAttestationSerialized(bytes)).toBe(attestation.data.slot);
      expect(getBlockRootFromAttestationSerialized(bytes)).toBe(toHex(attestation.data.beaconBlockRoot));

      if (isElectra) {
        expect(getAggregationBitsFromAttestationSerialized(ForkName.electra, bytes)?.toBoolArray()).toEqual(
          attestation.aggregationBits.toBoolArray()
        );
        expect(getCommitteeBitsFromAttestationSerialized(bytes)).toEqual(attestation.committeeBits);
        expect(getSignatureFromAttestationSerialized(ForkName.electra, bytes)).toEqual(attestation.signature);
      } else {
        expect(getAggregationBitsFromAttestationSerialized(ForkName.phase0, bytes)?.toBoolArray()).toEqual(
          attestation.aggregationBits.toBoolArray()
        );
        expect(getSignatureFromAttestationSerialized(ForkName.phase0, bytes)).toEqual(attestation.signature);
      }

      const attDataBase64 = ssz.phase0.AttestationData.serialize(attestation.data);
      expect(getSeenAttDataKeyPhase0(bytes)).toBe(Buffer.from(attDataBase64).toString("base64"));
    });
  }

  it("getSlotFromAttestationSerialized - invalid data", () => {
    const invalidSlotDataSizes = [0, 4, 11];
    for (const size of invalidSlotDataSizes) {
      expect(getSlotFromAttestationSerialized(Buffer.alloc(size))).toBeNull();
    }
  });

  it("getBlockRootFromAttestationSerialized - invalid data", () => {
    const invalidBlockRootDataSizes = [0, 4, 20, 49];
    for (const size of invalidBlockRootDataSizes) {
      expect(getBlockRootFromAttestationSerialized(Buffer.alloc(size))).toBeNull();
    }
  });

  it("getAttDataBase64FromAttestationSerialized - invalid data", () => {
    const invalidAttDataBase64DataSizes = [0, 4, 100, 128, 131];
    for (const size of invalidAttDataBase64DataSizes) {
      expect(getSeenAttDataKeyPhase0(Buffer.alloc(size))).toBeNull();
    }
  });

  it("getAggregateionBitsFromAttestationSerialized - invalid data", () => {
    const invalidAggregationBitsDataSizes = [0, 4, 100, 128, 227];
    for (const size of invalidAggregationBitsDataSizes) {
      expect(getAggregationBitsFromAttestationSerialized(ForkName.phase0, Buffer.alloc(size))).toBeNull();
      expect(getAggregationBitsFromAttestationSerialized(ForkName.electra, Buffer.alloc(size))).toBeNull();
    }
  });

  it("getSignatureFromAttestationSerialized - invalid data", () => {
    const invalidSignatureDataSizes = [0, 4, 100, 128, 227];
    for (const size of invalidSignatureDataSizes) {
      expect(getSignatureFromAttestationSerialized(ForkName.phase0, Buffer.alloc(size))).toBeNull();
      expect(getSignatureFromAttestationSerialized(ForkName.electra, Buffer.alloc(size))).toBeNull();
    }
  });
});

describe("aggregateAndProof SSZ serialized picking", () => {
  const testCases: phase0.SignedAggregateAndProof[] = [
    ssz.phase0.SignedAggregateAndProof.defaultValue(),
    signedAggregateAndProofFromValues(
      4_000_000,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      200_00,
      "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeffffffffffffffffffffffffffffffff"
    ),
    ssz.electra.SignedAggregateAndProof.defaultValue(),
  ];

  for (const [i, signedAggregateAndProof] of testCases.entries()) {
    it(`signedAggregateAndProof ${i}`, () => {
      const bytes = ssz.phase0.SignedAggregateAndProof.serialize(signedAggregateAndProof);

      expect(getSlotFromSignedAggregateAndProofSerialized(bytes)).toBe(
        signedAggregateAndProof.message.aggregate.data.slot
      );
      expect(getBlockRootFromSignedAggregateAndProofSerialized(bytes)).toBe(
        toHex(signedAggregateAndProof.message.aggregate.data.beaconBlockRoot)
      );

      const attDataBase64 = ssz.phase0.AttestationData.serialize(signedAggregateAndProof.message.aggregate.data);
      expect(getAttDataBase64FromSignedAggregateAndProofSerialized(bytes)).toBe(
        Buffer.from(attDataBase64).toString("base64")
      );
    });
  }

  it("getSlotFromSignedAggregateAndProofSerialized - invalid data", () => {
    const invalidSlotDataSizes = [0, 4, 11];
    for (const size of invalidSlotDataSizes) {
      expect(getSlotFromSignedAggregateAndProofSerialized(Buffer.alloc(size))).toBeNull();
    }
  });

  it("getBlockRootFromSignedAggregateAndProofSerialized - invalid data", () => {
    const invalidBlockRootDataSizes = [0, 4, 20, 227];
    for (const size of invalidBlockRootDataSizes) {
      expect(getBlockRootFromSignedAggregateAndProofSerialized(Buffer.alloc(size))).toBeNull();
    }
  });

  it("getAttDataBase64FromSignedAggregateAndProofSerialized - invalid data", () => {
    const invalidAttDataBase64DataSizes = [0, 4, 100, 128, 339];
    for (const size of invalidAttDataBase64DataSizes) {
      expect(getAttDataBase64FromSignedAggregateAndProofSerialized(Buffer.alloc(size))).toBeNull();
    }
  });
  it("getSlotFromSignedAggregateAndProofSerialized - invalid data - large slots", () => {
    const serialize = (slot: Slot): Uint8Array => {
      const s = ssz.phase0.SignedAggregateAndProof.defaultValue();
      s.message.aggregate.data.slot = slot;
      return ssz.phase0.SignedAggregateAndProof.serialize(s);
    };
    expect(getSlotFromSignedAggregateAndProofSerialized(serialize(0xffffffff))).toBe(0xffffffff);
    expect(getSlotFromSignedAggregateAndProofSerialized(serialize(0x0100000000))).toBeNull();
  });
});

describe("signedBeaconBlock SSZ serialized picking", () => {
  const testCases = [ssz.phase0.SignedBeaconBlock.defaultValue(), signedBeaconBlockFromValues(1_000_000)];

  for (const [i, signedBeaconBlock] of testCases.entries()) {
    const bytes = ssz.phase0.SignedBeaconBlock.serialize(signedBeaconBlock);
    it(`signedBeaconBlock ${i}`, () => {
      expect(getSlotFromSignedBeaconBlockSerialized(bytes)).toBe(signedBeaconBlock.message.slot);
    });
  }

  it("getSlotFromSignedBeaconBlockSerialized - invalid data", () => {
    const invalidSlotDataSizes = [0, 50, 104];
    for (const size of invalidSlotDataSizes) {
      expect(getSlotFromSignedBeaconBlockSerialized(Buffer.alloc(size))).toBeNull();
    }
  });
});

describe("BlobSidecar SSZ serialized picking", () => {
  const testCases = [ssz.deneb.BlobSidecar.defaultValue(), blobSidecarFromValues(1_000_000)];

  for (const [i, blobSidecar] of testCases.entries()) {
    const bytes = ssz.deneb.BlobSidecar.serialize(blobSidecar);
    it(`blobSidecar ${i}`, () => {
      expect(getSlotFromBlobSidecarSerialized(bytes)).toBe(blobSidecar.signedBlockHeader.message.slot);
    });
  }

  it("blobSidecar - invalid data", () => {
    const invalidSlotDataSizes = [0, 20, 38];
    for (const size of invalidSlotDataSizes) {
      expect(getSlotFromBlobSidecarSerialized(Buffer.alloc(size))).toBeNull();
    }
  });
});

function attestationFromValues(
  slot: Slot,
  blockRoot: RootHex,
  targetEpoch: Epoch,
  targetRoot: RootHex
): phase0.Attestation {
  const attestation = ssz.phase0.Attestation.defaultValue();
  attestation.data.slot = slot;
  attestation.data.beaconBlockRoot = fromHex(blockRoot);
  attestation.data.target.epoch = targetEpoch;
  attestation.data.target.root = fromHex(targetRoot);
  return attestation;
}

function signedAggregateAndProofFromValues(
  slot: Slot,
  blockRoot: RootHex,
  targetEpoch: Epoch,
  targetRoot: RootHex
): phase0.SignedAggregateAndProof {
  const signedAggregateAndProof = ssz.phase0.SignedAggregateAndProof.defaultValue();
  signedAggregateAndProof.message.aggregate.data.slot = slot;
  signedAggregateAndProof.message.aggregate.data.beaconBlockRoot = fromHex(blockRoot);
  signedAggregateAndProof.message.aggregate.data.target.epoch = targetEpoch;
  signedAggregateAndProof.message.aggregate.data.target.root = fromHex(targetRoot);
  return signedAggregateAndProof;
}

function signedBeaconBlockFromValues(slot: Slot): phase0.SignedBeaconBlock {
  const signedBeaconBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
  signedBeaconBlock.message.slot = slot;
  return signedBeaconBlock;
}

function blobSidecarFromValues(slot: Slot): deneb.BlobSidecar {
  const blobSidecar = ssz.deneb.BlobSidecar.defaultValue();
  blobSidecar.signedBlockHeader.message.slot = slot;
  return blobSidecar;
}
