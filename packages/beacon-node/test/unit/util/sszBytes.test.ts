import {BitArray} from "@chainsafe/ssz";
import {ForkName, MAX_COMMITTEES_PER_SLOT} from "@lodestar/params";
import {
  CommitteeIndex,
  Epoch,
  RootHex,
  SingleAttestation,
  Slot,
  ValidatorIndex,
  deneb,
  electra,
  isElectraSingleAttestation,
  phase0,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {fromHex, toHex, toRootHex} from "@lodestar/utils";
import {describe, expect, it} from "vitest";
import {
  getAggregationBitsFromAttestationSerialized,
  getAttDataFromAttestationSerialized,
  getAttDataFromSignedAggregateAndProofElectra,
  getAttDataFromSignedAggregateAndProofPhase0,
  getAttDataFromSingleAttestationSerialized,
  getAttesterIndexFromSingleAttestationSerialized,
  getBlockRootFromAttestationSerialized,
  getBlockRootFromSignedAggregateAndProofSerialized,
  getBlockRootFromSingleAttestationSerialized,
  getCommitteeBitsFromSignedAggregateAndProofElectra,
  getCommitteeIndexFromSingleAttestationSerialized,
  getSignatureFromAttestationSerialized,
  getSignatureFromSingleAttestationSerialized,
  getSlotFromAttestationSerialized,
  getSlotFromBlobSidecarSerialized,
  getSlotFromSignedAggregateAndProofSerialized,
  getSlotFromSignedBeaconBlockSerialized,
  getSlotFromSingleAttestationSerialized,
} from "../../../src/util/sszBytes.js";

describe("SinlgeAttestation SSZ serialized picking", () => {
  const testCases: SingleAttestation[] = [
    ssz.phase0.Attestation.defaultValue(),
    phase0SingleAttestationFromValues(
      4_000_000,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      200_00,
      "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeffffffffffffffffffffffffffffffff"
    ),
    ssz.electra.Attestation.defaultValue(),
    {
      ...electraSingleAttestationFromValues(
        4_000_000,
        127,
        1,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        200_00,
        "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeffffffffffffffffffffffffffffffff"
      ),
    },
  ];

  for (const [i, attestation] of testCases.entries()) {
    it(`attestation ${i}`, () => {
      const isElectra = isElectraSingleAttestation(attestation);
      const bytes = isElectra
        ? sszTypesFor(ForkName.electra, "SingleAttestation").serialize(attestation)
        : ssz.phase0.Attestation.serialize(attestation);

      if (isElectra) {
        expect(getSlotFromSingleAttestationSerialized(bytes)).toEqual(attestation.data.slot);
        expect(getCommitteeIndexFromSingleAttestationSerialized(ForkName.electra, bytes)).toEqual(
          attestation.committeeIndex
        );
        expect(getAttesterIndexFromSingleAttestationSerialized(bytes)).toEqual(attestation.attesterIndex);
        expect(getBlockRootFromSingleAttestationSerialized(bytes)).toEqual(toRootHex(attestation.data.beaconBlockRoot));
        // base64, not hex
        expect(getAttDataFromSingleAttestationSerialized(bytes)).toEqual(
          Buffer.from(ssz.phase0.AttestationData.serialize(attestation.data)).toString("base64")
        );
        expect(getSignatureFromSingleAttestationSerialized(bytes)).toEqual(attestation.signature);
      } else {
        expect(getSlotFromAttestationSerialized(bytes)).toBe(attestation.data.slot);
        expect(getCommitteeIndexFromSingleAttestationSerialized(ForkName.phase0, bytes)).toEqual(
          attestation.data.index
        );
        expect(getBlockRootFromAttestationSerialized(bytes)).toBe(toRootHex(attestation.data.beaconBlockRoot));
        expect(getAggregationBitsFromAttestationSerialized(bytes)?.toBoolArray()).toEqual(
          attestation.aggregationBits.toBoolArray()
        );
        const attDataBase64 = ssz.phase0.AttestationData.serialize(attestation.data);
        expect(getAttDataFromAttestationSerialized(bytes)).toBe(Buffer.from(attDataBase64).toString("base64"));
        expect(getSignatureFromAttestationSerialized(bytes)).toEqual(attestation.signature);
      }
    });
  }

  // negative tests for phase0
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

  it("getAttDataFromAttestationSerialized - invalid data", () => {
    const invalidAttDataBase64DataSizes = [0, 4, 100, 128, 131];
    for (const size of invalidAttDataBase64DataSizes) {
      expect(getAttDataFromAttestationSerialized(Buffer.alloc(size))).toBeNull();
    }
  });

  it("getAggregationBitsFromAttestationSerialized - invalid data", () => {
    const invalidAggregationBitsDataSizes = [0, 4, 100, 128, 227];
    for (const size of invalidAggregationBitsDataSizes) {
      expect(getAggregationBitsFromAttestationSerialized(Buffer.alloc(size))).toBeNull();
      expect(getAggregationBitsFromAttestationSerialized(Buffer.alloc(size))).toBeNull();
    }
  });

  it("getSignatureFromAttestationSerialized - invalid data", () => {
    const invalidSignatureDataSizes = [0, 4, 100, 128, 227];
    for (const size of invalidSignatureDataSizes) {
      expect(getSignatureFromAttestationSerialized(Buffer.alloc(size))).toBeNull();
      expect(getSignatureFromAttestationSerialized(Buffer.alloc(size))).toBeNull();
    }
  });

  // negative tests for electra
  it("getSlotFromSingleAttestationSerialized - invalid data", () => {
    const invalidSlotDataSizes = [0, 4, 11];
    for (const size of invalidSlotDataSizes) {
      expect(getSlotFromSingleAttestationSerialized(Buffer.alloc(size))).toBeNull();
    }
  });

  it("getCommitteeIndexFromSingleAttestationSerialized - invalid data", () => {
    const invalidCommitteeIndexDataSizes = [0, 4, 11];
    for (const size of invalidCommitteeIndexDataSizes) {
      expect(getCommitteeIndexFromSingleAttestationSerialized(ForkName.electra, Buffer.alloc(size))).toBeNull();
    }
  });

  it("getBlockRootFromSingleAttestationSerialized - invalid data", () => {
    const invalidBlockRootDataSizes = [0, 4, 20, 49];
    for (const size of invalidBlockRootDataSizes) {
      expect(getBlockRootFromSingleAttestationSerialized(Buffer.alloc(size))).toBeNull();
    }
  });

  it("getAttDataFromSingleAttestationSerialized - invalid data", () => {
    const invalidAttDataBase64DataSizes = [0, 4, 100, 128, 131];
    for (const size of invalidAttDataBase64DataSizes) {
      expect(getAttDataFromSingleAttestationSerialized(Buffer.alloc(size))).toBeNull();
    }
  });

  it("getSignatureFromSingleAttestationSerialized - invalid data", () => {
    const invalidSignatureDataSizes = [0, 4, 100, 128, 227];
    for (const size of invalidSignatureDataSizes) {
      expect(getSignatureFromSingleAttestationSerialized(Buffer.alloc(size))).toBeNull();
    }
  });
});

describe("phase0 SignedAggregateAndProof SSZ serialized picking", () => {
  const testCases: phase0.SignedAggregateAndProof[] = [
    ssz.phase0.SignedAggregateAndProof.defaultValue(),
    phase0SignedAggregateAndProofFromValues(
      4_000_000,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      200_00,
      "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeffffffffffffffffffffffffffffffff"
    ),
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
      expect(getAttDataFromSignedAggregateAndProofPhase0(bytes)).toBe(Buffer.from(attDataBase64).toString("base64"));
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
      expect(getAttDataFromSignedAggregateAndProofPhase0(Buffer.alloc(size))).toBeNull();
    }
  });
});

describe("electra SignedAggregateAndProof SSZ serialized picking", () => {
  const testCases: electra.SignedAggregateAndProof[] = [
    ssz.electra.SignedAggregateAndProof.defaultValue(),
    electraSignedAggregateAndProofFromValues(
      4_000_000,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      200_00,
      "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeffffffffffffffffffffffffffffffff"
    ),
  ];

  for (const [i, signedAggregateAndProof] of testCases.entries()) {
    it(`signedAggregateAndProof ${i}`, () => {
      const bytes = ssz.electra.SignedAggregateAndProof.serialize(signedAggregateAndProof);

      expect(getSlotFromSignedAggregateAndProofSerialized(bytes)).toBe(
        signedAggregateAndProof.message.aggregate.data.slot
      );
      expect(getBlockRootFromSignedAggregateAndProofSerialized(bytes)).toBe(
        toHex(signedAggregateAndProof.message.aggregate.data.beaconBlockRoot)
      );

      const attDataBase64 = ssz.phase0.AttestationData.serialize(signedAggregateAndProof.message.aggregate.data);
      const committeeBits = ssz.electra.CommitteeBits.serialize(
        signedAggregateAndProof.message.aggregate.committeeBits
      );

      expect(getAttDataFromSignedAggregateAndProofElectra(bytes)).toBe(Buffer.from(attDataBase64).toString("base64"));
      expect(getCommitteeBitsFromSignedAggregateAndProofElectra(bytes)).toBe(
        Buffer.from(committeeBits).toString("base64")
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
      expect(getAttDataFromSignedAggregateAndProofPhase0(Buffer.alloc(size))).toBeNull();
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

function phase0SingleAttestationFromValues(
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

function electraSingleAttestationFromValues(
  slot: Slot,
  committeeIndex: CommitteeIndex,
  attesterIndex: ValidatorIndex,
  blockRoot: RootHex,
  targetEpoch: Epoch,
  targetRoot: RootHex
): electra.SingleAttestation {
  const attestation = ssz.electra.SingleAttestation.defaultValue();
  attestation.data.slot = slot;
  attestation.data.beaconBlockRoot = fromHex(blockRoot);
  attestation.data.target.epoch = targetEpoch;
  attestation.data.target.root = fromHex(targetRoot);
  attestation.committeeIndex = committeeIndex;
  attestation.attesterIndex = attesterIndex;
  return attestation;
}

function phase0SignedAggregateAndProofFromValues(
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

function electraSignedAggregateAndProofFromValues(
  slot: Slot,
  blockRoot: RootHex,
  targetEpoch: Epoch,
  targetRoot: RootHex
): electra.SignedAggregateAndProof {
  const signedAggregateAndProof = ssz.electra.SignedAggregateAndProof.defaultValue();
  signedAggregateAndProof.message.aggregate.data.slot = slot;
  signedAggregateAndProof.message.aggregate.data.beaconBlockRoot = fromHex(blockRoot);
  signedAggregateAndProof.message.aggregate.data.target.epoch = targetEpoch;
  signedAggregateAndProof.message.aggregate.data.target.root = fromHex(targetRoot);
  signedAggregateAndProof.message.aggregate.committeeBits = BitArray.fromSingleBit(MAX_COMMITTEES_PER_SLOT, 1);
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
