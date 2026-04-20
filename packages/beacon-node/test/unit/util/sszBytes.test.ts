import {describe, expect, it} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {ForkName, MAX_COMMITTEES_PER_SLOT} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {
  CommitteeIndex,
  Epoch,
  RootHex,
  SingleAttestation,
  Slot,
  ValidatorIndex,
  deneb,
  electra,
  gloas,
  isElectraSingleAttestation,
  phase0,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {fromHex, toHex, toRootHex} from "@lodestar/utils";
import {kzg} from "../../../src/util/kzg.js";
import {
  getAggregationBitsFromAttestationSerialized,
  getAttDataFromAttestationSerialized,
  getAttDataFromSignedAggregateAndProofElectra,
  getAttDataFromSignedAggregateAndProofPhase0,
  getAttDataFromSingleAttestationSerialized,
  getAttesterIndexFromSingleAttestationSerialized,
  getBeaconBlockRootFromDataColumnSidecarSerialized,
  getBeaconBlockRootFromExecutionPayloadEnvelopeSerialized,
  getBlobKzgCommitmentsCountFromSignedBeaconBlockSerialized,
  getBlockRootFromAttestationSerialized,
  getBlockRootFromPayloadAttestationMessageSerialized,
  getBlockRootFromSignedAggregateAndProofSerialized,
  getBlockRootFromSingleAttestationSerialized,
  getCommitteeBitsFromSignedAggregateAndProofElectra,
  getCommitteeIndexFromSingleAttestationSerialized,
  getDataIndexFromSignedAggregateAndProofSerialized,
  getDataIndexFromSingleAttestationSerialized,
  getLastProcessedSlotFromBeaconStateSerialized,
  getParentBlockHashFromGloasSignedBeaconBlockSerialized,
  getParentBlockHashFromSignedExecutionPayloadBidSerialized,
  getParentBlockRootFromSignedExecutionPayloadBidSerialized,
  getParentRootFromSignedBeaconBlockSerialized,
  getPayloadPresentFromPayloadAttestationMessageSerialized,
  getSignatureFromAttestationSerialized,
  getSignatureFromSingleAttestationSerialized,
  getSlotFromAttestationSerialized,
  getSlotFromBeaconStateSerialized,
  getSlotFromBlobSidecarSerialized,
  getSlotFromDataColumnSidecarSerialized,
  getSlotFromExecutionPayloadEnvelopeSerialized,
  getSlotFromPayloadAttestationMessageSerialized,
  getSlotFromSignedAggregateAndProofSerialized,
  getSlotFromSignedBeaconBlockSerialized,
  getSlotFromSignedExecutionPayloadBidSerialized,
  getSlotFromSingleAttestationSerialized,
} from "../../../src/util/sszBytes.js";
import {generateRandomBlob} from "../../utils/kzg.js";

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
        expect(getDataIndexFromSingleAttestationSerialized(ForkName.electra, bytes)).toEqual(attestation.data.index);
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
        expect(getDataIndexFromSingleAttestationSerialized(ForkName.phase0, bytes)).toEqual(attestation.data.index);
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

  it("getDataIndexFromSingleAttestationSerialized - invalid data", () => {
    const invalidDataIndexSizes = [0, 4, 11];
    for (const size of invalidDataIndexSizes) {
      expect(getDataIndexFromSingleAttestationSerialized(ForkName.electra, Buffer.alloc(size))).toBeNull();
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

describe("getDataIndexFromSignedAggregateAndProofSerialized", () => {
  it("phase0 - extracts data.index from aggregate", () => {
    const agg = phase0SignedAggregateAndProofFromValues(
      4_000_000,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      200_00,
      "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeffffffffffffffffffffffffffffffff"
    );
    agg.message.aggregate.data.index = 3;
    const bytes = ssz.phase0.SignedAggregateAndProof.serialize(agg);
    expect(getDataIndexFromSignedAggregateAndProofSerialized(bytes)).toBe(3);
  });

  it("electra - extracts data.index from aggregate", () => {
    const agg = electraSignedAggregateAndProofFromValues(
      4_000_000,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      200_00,
      "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeffffffffffffffffffffffffffffffff"
    );
    agg.message.aggregate.data.index = 7;
    const bytes = ssz.electra.SignedAggregateAndProof.serialize(agg);
    expect(getDataIndexFromSignedAggregateAndProofSerialized(bytes)).toBe(7);
  });

  it("invalid data returns null", () => {
    for (const size of [0, 4, 219]) {
      expect(getDataIndexFromSignedAggregateAndProofSerialized(Buffer.alloc(size))).toBeNull();
    }
  });
});

describe("signedBeaconBlock SSZ serialized picking", () => {
  const testCases = [ssz.phase0.SignedBeaconBlock.defaultValue(), signedBeaconBlockFromValues(1_000_000)];

  for (const [i, signedBeaconBlock] of testCases.entries()) {
    const bytes = ssz.phase0.SignedBeaconBlock.serialize(signedBeaconBlock);
    it(`signedBeaconBlock ${i}`, () => {
      expect(getSlotFromSignedBeaconBlockSerialized(bytes)).toBe(signedBeaconBlock.message.slot);
      expect(getParentRootFromSignedBeaconBlockSerialized(bytes)).toBe(toRootHex(signedBeaconBlock.message.parentRoot));
    });
  }

  it("getSlotFromSignedBeaconBlockSerialized - invalid data", () => {
    const invalidSlotDataSizes = [0, 50, 104];
    for (const size of invalidSlotDataSizes) {
      expect(getSlotFromSignedBeaconBlockSerialized(Buffer.alloc(size))).toBeNull();
    }
  });

  it("getParentRootFromSignedBeaconBlockSerialized - invalid data", () => {
    for (const size of [0, 100, 147]) {
      expect(getParentRootFromSignedBeaconBlockSerialized(Buffer.alloc(size))).toBeNull();
    }
  });
});

describe("getParentBlockHashFromGloasSignedBeaconBlockSerialized", () => {
  it("extracts parent block hash from GLOAS signed beacon block", () => {
    const signedBeaconBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
    signedBeaconBlock.message.body.signedExecutionPayloadBid.message.parentBlockHash = Buffer.alloc(32, 0xaa);
    const bytes = ssz.gloas.SignedBeaconBlock.serialize(signedBeaconBlock);

    expect(getParentBlockHashFromGloasSignedBeaconBlockSerialized(bytes)).toBe(
      toHex(signedBeaconBlock.message.body.signedExecutionPayloadBid.message.parentBlockHash)
    );
  });

  it("returns null for invalid data", () => {
    for (const size of [0, 200, 571]) {
      expect(getParentBlockHashFromGloasSignedBeaconBlockSerialized(Buffer.alloc(size))).toBeNull();
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

describe("getBlobKzgCommitmentsCountFromSignedBeaconBlockSerialized", () => {
  const config = createChainForkConfig({
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 5,
    ELECTRA_FORK_EPOCH: 10,
    FULU_FORK_EPOCH: 15,
    GLOAS_FORK_EPOCH: 20,
  });

  it("should return 0 blob count pre deneb", async () => {
    const slot = 1;
    const block = config.getForkTypes(slot).SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    const blockBytes = config.getForkTypes(slot).SignedBeaconBlock.serialize(block);

    const blobsCount = getBlobKzgCommitmentsCountFromSignedBeaconBlockSerialized(config, blockBytes);

    expect(blobsCount).toBe(0);
  });

  it("should return blob count post deneb for empty blobs", async () => {
    const slot = computeStartSlotAtEpoch(5);
    const block = config.getForkTypes(slot).SignedBeaconBlock.defaultValue() as deneb.SignedBeaconBlock;
    block.message.slot = slot;
    block.message.body.blobKzgCommitments = [];
    const blockBytes = config.getForkTypes(slot).SignedBeaconBlock.serialize(block);

    const blobsCount = getBlobKzgCommitmentsCountFromSignedBeaconBlockSerialized(config, blockBytes);

    expect(blobsCount).toBe(0);
  });

  it("should return blob count post deneb with blobs", async () => {
    const slot = computeStartSlotAtEpoch(5);
    const block = config.getForkTypes(slot).SignedBeaconBlock.defaultValue() as deneb.SignedBeaconBlock;
    const blobs = [generateRandomBlob(), generateRandomBlob(), generateRandomBlob()];
    const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
    block.message.body.blobKzgCommitments = kzgCommitments;
    block.message.slot = slot;
    const blockBytes = config.getForkTypes(slot).SignedBeaconBlock.serialize(block);

    const blobsCount = getBlobKzgCommitmentsCountFromSignedBeaconBlockSerialized(config, blockBytes);

    expect(blobsCount).toBe(blobs.length);
  });
});

describe("BeaconState ssz serialized picking", () => {
  it("getLastProcessedSlotFromBeaconStateSerialized", () => {
    const slot = 1_000_000;
    const state = ssz.phase0.BeaconState.defaultValue();
    state.latestBlockHeader.slot = slot;
    const bytes = ssz.phase0.BeaconState.serialize(state);
    expect(getLastProcessedSlotFromBeaconStateSerialized(bytes)).toBe(slot);
  });

  it("getLastProcessedSlotFromBeaconStateSerialized - invalid data", () => {
    const invalidSlotDataSizes = [0, 50, 60];
    for (const size of invalidSlotDataSizes) {
      expect(getLastProcessedSlotFromBeaconStateSerialized(Buffer.alloc(size))).toBeNull();
    }
  });

  it("getSlotFromBeaconStateSerialized", () => {
    const slot = 1_000_000;
    const state = ssz.phase0.BeaconState.defaultValue();
    state.slot = slot;
    const bytes = ssz.phase0.BeaconState.serialize(state);
    expect(getSlotFromBeaconStateSerialized(bytes)).toBe(slot);
  });

  it("getSlotFromBeaconStateSerialized - invalid data", () => {
    const invalidSlotDataSizes = [0, 20, 39];
    for (const size of invalidSlotDataSizes) {
      expect(getSlotFromBeaconStateSerialized(Buffer.alloc(size))).toBeNull();
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

describe("SignedExecutionPayloadEnvelope SSZ serialized picking", () => {
  const testCases: {slot: Slot; blockRoot: RootHex}[] = [
    {slot: 0, blockRoot: "0x" + "00".repeat(32)},
    {slot: 1_000_000, blockRoot: "0x" + "aa".repeat(32)},
    {slot: 4_294_967_295, blockRoot: "0x" + "ff".repeat(32)}, // max uint32
  ];

  for (const {slot, blockRoot} of testCases) {
    it(`slot=${slot}`, () => {
      const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
      envelope.message.payload.slotNumber = slot;
      envelope.message.beaconBlockRoot = fromHex(blockRoot);
      const bytes = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope);

      expect(getSlotFromExecutionPayloadEnvelopeSerialized(bytes)).toBe(slot);
      expect(getBeaconBlockRootFromExecutionPayloadEnvelopeSerialized(bytes)).toBe(blockRoot);
    });
  }

  it("getSlotFromExecutionPayloadEnvelopeSerialized - invalid data", () => {
    // slotNumber is at offset 676 within the serialized payload, need at least 684 bytes
    const invalidSizes = [0, 50, 100, 683];
    for (const size of invalidSizes) {
      expect(getSlotFromExecutionPayloadEnvelopeSerialized(Buffer.alloc(size))).toBeNull();
    }
  });

  it("getBeaconBlockRootFromExecutionPayloadEnvelopeSerialized - invalid data", () => {
    // Block root is at offset 116, need at least 148 bytes
    const invalidSizes = [0, 50, 100, 147];
    for (const size of invalidSizes) {
      expect(getBeaconBlockRootFromExecutionPayloadEnvelopeSerialized(Buffer.alloc(size))).toBeNull();
    }
  });
});

describe("DataColumnSidecar SSZ serialized picking (fork-aware)", () => {
  describe("Fulu (pre-Gloas)", () => {
    const testCases: {slot: Slot}[] = [{slot: 0}, {slot: 500_000}, {slot: 4_294_967_295}];

    for (const {slot} of testCases) {
      it(`slot=${slot}`, () => {
        const sidecar = ssz.fulu.DataColumnSidecar.defaultValue();
        sidecar.signedBlockHeader.message.slot = slot;
        const bytes = ssz.fulu.DataColumnSidecar.serialize(sidecar);

        expect(getSlotFromDataColumnSidecarSerialized(bytes, ForkName.fulu)).toBe(slot);
      });
    }

    it("getSlotFromDataColumnSidecarSerialized - invalid data", () => {
      // Slot is at offset 20 for pre-Gloas, need at least 28 bytes
      const invalidSizes = [0, 10, 27];
      for (const size of invalidSizes) {
        expect(getSlotFromDataColumnSidecarSerialized(Buffer.alloc(size), ForkName.fulu)).toBeNull();
      }
    });
  });

  describe("Gloas", () => {
    const testCases: {slot: Slot; blockRoot: RootHex}[] = [
      {slot: 0, blockRoot: "0x" + "00".repeat(32)},
      {slot: 600_000, blockRoot: "0x" + "bb".repeat(32)},
      {slot: 4_294_967_295, blockRoot: "0x" + "ff".repeat(32)},
    ];

    for (const {slot, blockRoot} of testCases) {
      it(`slot=${slot}`, () => {
        const sidecar = ssz.gloas.DataColumnSidecar.defaultValue();
        sidecar.slot = slot;
        sidecar.beaconBlockRoot = fromHex(blockRoot);
        const bytes = ssz.gloas.DataColumnSidecar.serialize(sidecar);

        expect(getSlotFromDataColumnSidecarSerialized(bytes, ForkName.gloas)).toBe(slot);
        expect(getBeaconBlockRootFromDataColumnSidecarSerialized(bytes)).toBe(blockRoot);
      });
    }

    it("getSlotFromDataColumnSidecarSerialized - invalid data", () => {
      // Slot is at offset 16 for Gloas, need at least 24 bytes
      const invalidSizes = [0, 10, 23];
      for (const size of invalidSizes) {
        expect(getSlotFromDataColumnSidecarSerialized(Buffer.alloc(size), ForkName.gloas)).toBeNull();
      }
    });

    it("getBeaconBlockRootFromDataColumnSidecarSerialized - invalid data", () => {
      // Block root is at offset 24 for Gloas, need at least 56 bytes
      const invalidSizes = [0, 20, 55];
      for (const size of invalidSizes) {
        expect(getBeaconBlockRootFromDataColumnSidecarSerialized(Buffer.alloc(size))).toBeNull();
      }
    });
  });
});

describe("PayloadAttestationMessage SSZ serialized picking", () => {
  const testCases = [
    ssz.gloas.PayloadAttestationMessage.defaultValue(),
    payloadAttestationMessageFromValues(1_000_000, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
  ];

  for (const [i, msg] of testCases.entries()) {
    it(`payloadAttestationMessage ${i}`, () => {
      const bytes = ssz.gloas.PayloadAttestationMessage.serialize(msg);

      expect(getSlotFromPayloadAttestationMessageSerialized(bytes)).toBe(msg.data.slot);
      expect(getBlockRootFromPayloadAttestationMessageSerialized(bytes)).toBe(toRootHex(msg.data.beaconBlockRoot));
      expect(getPayloadPresentFromPayloadAttestationMessageSerialized(bytes)).toBe(msg.data.payloadPresent);
    });
  }

  it("getPayloadPresentFromPayloadAttestationMessageSerialized - true/false", () => {
    const msg = ssz.gloas.PayloadAttestationMessage.defaultValue();
    msg.data.payloadPresent = true;
    expect(
      getPayloadPresentFromPayloadAttestationMessageSerialized(ssz.gloas.PayloadAttestationMessage.serialize(msg))
    ).toBe(true);
    msg.data.payloadPresent = false;
    expect(
      getPayloadPresentFromPayloadAttestationMessageSerialized(ssz.gloas.PayloadAttestationMessage.serialize(msg))
    ).toBe(false);
  });

  it("getSlotFromPayloadAttestationMessageSerialized - invalid data", () => {
    const invalidSlotDataSizes = [0, 20, 47];
    for (const size of invalidSlotDataSizes) {
      expect(getSlotFromPayloadAttestationMessageSerialized(Buffer.alloc(size))).toBeNull();
    }
  });

  it("getBlockRootFromPayloadAttestationMessageSerialized - invalid data", () => {
    const invalidBlockRootDataSizes = [0, 4, 39];
    for (const size of invalidBlockRootDataSizes) {
      expect(getBlockRootFromPayloadAttestationMessageSerialized(Buffer.alloc(size))).toBeNull();
    }
  });

  it("getPayloadPresentFromPayloadAttestationMessageSerialized - invalid data", () => {
    for (const size of [0, 20, 47]) {
      expect(getPayloadPresentFromPayloadAttestationMessageSerialized(Buffer.alloc(size))).toBeNull();
    }
  });
});

describe("SignedExecutionPayloadBid SSZ serialized picking", () => {
  const testCases = [
    ssz.gloas.SignedExecutionPayloadBid.defaultValue(),
    signedExecutionPayloadBidFromValues(1_000_000),
  ];

  for (const [i, bid] of testCases.entries()) {
    it(`signedExecutionPayloadBid ${i}`, () => {
      const bytes = ssz.gloas.SignedExecutionPayloadBid.serialize(bid);

      expect(getSlotFromSignedExecutionPayloadBidSerialized(bytes)).toBe(bid.message.slot);
      expect(getParentBlockHashFromSignedExecutionPayloadBidSerialized(bytes)).toBe(toHex(bid.message.parentBlockHash));
      expect(getParentBlockRootFromSignedExecutionPayloadBidSerialized(bytes)).toBe(toHex(bid.message.parentBlockRoot));
    });
  }

  it("getSlotFromSignedExecutionPayloadBidSerialized - invalid data", () => {
    const invalidSlotDataSizes = [0, 100, 271];
    for (const size of invalidSlotDataSizes) {
      expect(getSlotFromSignedExecutionPayloadBidSerialized(Buffer.alloc(size))).toBeNull();
    }
  });

  it("getParentBlockHashFromSignedExecutionPayloadBidSerialized - invalid data", () => {
    for (const size of [0, 99, 131]) {
      expect(getParentBlockHashFromSignedExecutionPayloadBidSerialized(Buffer.alloc(size))).toBeNull();
    }
  });

  it("getParentBlockRootFromSignedExecutionPayloadBidSerialized - invalid data", () => {
    for (const size of [0, 99, 163]) {
      expect(getParentBlockRootFromSignedExecutionPayloadBidSerialized(Buffer.alloc(size))).toBeNull();
    }
  });
});

function payloadAttestationMessageFromValues(slot: Slot, blockRoot: RootHex): gloas.PayloadAttestationMessage {
  const msg = ssz.gloas.PayloadAttestationMessage.defaultValue();
  msg.data.slot = slot;
  msg.data.beaconBlockRoot = fromHex(blockRoot);
  return msg;
}

function signedExecutionPayloadBidFromValues(slot: Slot): gloas.SignedExecutionPayloadBid {
  const bid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  bid.message.slot = slot;
  bid.message.parentBlockHash = Buffer.alloc(32, 0xaa);
  bid.message.parentBlockRoot = Buffer.alloc(32, 0xbb);
  return bid;
}
