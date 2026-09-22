import crypto from "node:crypto";
import {describe, expect, it} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {BitArray} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {
  FAR_FUTURE_EPOCH,
  MAX_EFFECTIVE_BALANCE,
  PTC_SIZE,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE,
} from "@lodestar/params";
import {BLSSignature, ValidatorIndex, capella, gloas, phase0, ssz} from "@lodestar/types";
import {G2_POINT_AT_INFINITY, ZERO_HASH} from "../../../src/constants/index.js";
import {BeaconStateView} from "../../../src/index.js";
import {getBlockSignatureSets, getPayloadAttestationDataSigningRoot} from "../../../src/signatureSets/index.js";
import {createCachedBeaconStateTest, generateCachedState} from "../../../src/testUtils/state.js";
import {SignatureSetType, toBlsSignatureSet, verifySignatureSet} from "../../../src/util/signatureSets.js";
import {generateValidators} from "../../utils/validator.js";

const EMPTY_SIGNATURE = Buffer.alloc(96);

describe("signatureSets", () => {
  it("converts aggregate indices to the Lodestar-Z verifier representation", () => {
    const set = toBlsSignatureSet({
      type: SignatureSetType.aggregate,
      indices: [1, 2],
      signingRoot: Buffer.alloc(32, 3),
      signature: Buffer.alloc(96, 4),
    });

    expect(set).toMatchObject({indices: new Uint32Array([1, 2]), message: Buffer.alloc(32, 3)});
  });

  it("rejects aggregate validator indices outside uint32", () => {
    for (const index of [-1, 0.5, 2 ** 32]) {
      expect(() =>
        toBlsSignatureSet({
          type: SignatureSetType.aggregate,
          indices: [index],
          signingRoot: Buffer.alloc(32),
          signature: Buffer.alloc(96),
        })
      ).toThrow(`Invalid validator index ${index}`);
    }
  });

  it("verifies indexed sets through the shared Lodestar-Z cache", () => {
    pubkeyCache.reset();
    const secretKey = SecretKey.fromKeygen(Buffer.alloc(32, 42));
    const signingRoot = Buffer.alloc(32, 7);
    pubkeyCache.append(0, secretKey.toPublicKey().toBytes());

    expect(
      verifySignatureSet({
        type: SignatureSetType.indexed,
        index: 0,
        signingRoot,
        signature: secretKey.sign(signingRoot).toBytes(),
      })
    ).toBe(true);
  });

  it("should aggregate all signatures from a block", () => {
    const emptyBlockBody = ssz.capella.BeaconBlockBody.defaultValue();
    const block: capella.BeaconBlock = {
      slot: 0,
      proposerIndex: 0,
      parentRoot: crypto.randomBytes(32),
      stateRoot: ZERO_HASH,
      body: {
        ...emptyBlockBody,
        randaoReveal: Buffer.alloc(96),
        eth1Data: {
          depositRoot: crypto.randomBytes(32),
          blockHash: crypto.randomBytes(32),
          depositCount: 0n,
        },
        graffiti: crypto.randomBytes(32),
        proposerSlashings: [
          getMockProposerSlashings(
            {proposerIndex: 0, signature: EMPTY_SIGNATURE},
            {proposerIndex: 0, signature: EMPTY_SIGNATURE}
          ),
        ],
        attesterSlashings: [
          getMockAttesterSlashings(
            {attestingIndices: [0], signature: EMPTY_SIGNATURE},
            {attestingIndices: [0], signature: EMPTY_SIGNATURE}
          ),
        ],
        // Set to 1 since there's only one validator per committee
        attestations: [getMockAttestations(1)],
        deposits: [] as phase0.Deposit[],
        voluntaryExits: [getMockSignedVoluntaryExit({validatorIndex: 0, signature: EMPTY_SIGNATURE})],
        blsToExecutionChanges: [getMockSignedBlsToExecutionChange({validatorIndex: 0, signature: EMPTY_SIGNATURE})],
      },
    };

    const signedBlock: capella.SignedBeaconBlock = {
      message: block,
      signature: EMPTY_SIGNATURE,
    };

    // Generate active validators
    const validators = generateValidators(32, {
      balance: MAX_EFFECTIVE_BALANCE,
      activation: 0,
      exit: FAR_FUTURE_EPOCH,
    });
    for (const [i, validator] of validators.entries()) {
      validator.pubkey = SecretKey.fromKeygen(Buffer.alloc(32, i)).toPublicKey().toBytes();
    }

    const state = generateCachedState(config, {validators});
    const fork = state.config.getForkSeq(signedBlock.message.slot);
    const indexedAttestations = signedBlock.message.body.attestations.map((attestation) =>
      state.epochCtx.getIndexedAttestation(fork, attestation)
    );

    const signatureSets = getBlockSignatureSets(
      state.config,
      state.epochCtx.currentSyncCommitteeIndexed,
      new BeaconStateView(state),
      signedBlock,
      indexedAttestations
    );
    expect(signatureSets.length).toBe(
      // block signature
      1 +
        // randao reveal
        1 +
        // 1 x 2 proposerSlashing signatures
        2 +
        // 1 x 2 attesterSlashings signatures
        2 +
        // 1 x attestations
        1 +
        // 1 x voluntaryExits
        1
    );
  });

  it("should include payload attestation signatures from a gloas block", () => {
    const chainConfig = createChainForkConfig({
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    });
    // The block is at the first slot of an epoch, so its payload attestation uses the previous epoch's PTC
    const blockSlot = SLOTS_PER_EPOCH;
    const stateView = ssz.gloas.BeaconState.defaultViewDU();
    stateView.slot = blockSlot;
    const pubkeys: Uint8Array[] = [];
    for (let i = 0; i < 32; i++) {
      const validator = ssz.phase0.Validator.defaultViewDU();
      validator.pubkey = SecretKey.fromKeygen(Buffer.alloc(32, i)).toPublicKey().toBytes();
      validator.effectiveBalance = MAX_EFFECTIVE_BALANCE;
      validator.activationEpoch = 0;
      validator.exitEpoch = FAR_FUTURE_EPOCH;
      validator.withdrawableEpoch = FAR_FUTURE_EPOCH;
      pubkeys.push(validator.pubkey);
      stateView.validators.push(validator);
      stateView.balances.push(MAX_EFFECTIVE_BALANCE);
      stateView.previousEpochParticipation.push(0);
      stateView.currentEpochParticipation.push(0);
      stateView.inactivityScores.push(0);
    }
    const syncCommittee = {
      pubkeys: Array.from({length: SYNC_COMMITTEE_SIZE}, () => pubkeys[0]),
      aggregatePubkey: pubkeys[0],
    };
    stateView.currentSyncCommittee = ssz.altair.SyncCommittee.toViewDU(syncCommittee);
    stateView.nextSyncCommittee = ssz.altair.SyncCommittee.toViewDU(syncCommittee);
    stateView.commit();
    pubkeyCache.reset();
    const state = createCachedBeaconStateTest(stateView, chainConfig);

    const data: gloas.PayloadAttestationData = {
      beaconBlockRoot: ZERO_HASH,
      slot: blockSlot - 1,
      payloadPresent: true,
      blobDataAvailable: true,
    };
    const signature = SecretKey.fromKeygen(Buffer.alloc(32, 0))
      .sign(getPayloadAttestationDataSigningRoot(state.config, data))
      .toBytes();

    const signedBlock: gloas.SignedBeaconBlock = {
      message: {
        slot: blockSlot,
        proposerIndex: 0,
        parentRoot: ZERO_HASH,
        stateRoot: ZERO_HASH,
        body: {
          ...ssz.gloas.BeaconBlockBody.defaultValue(),
          syncAggregate: {
            syncCommitteeBits: BitArray.fromBitLen(SYNC_COMMITTEE_SIZE),
            syncCommitteeSignature: G2_POINT_AT_INFINITY,
          },
          payloadAttestations: [{aggregationBits: BitArray.fromSingleBit(PTC_SIZE, 0), data, signature}],
        },
      },
      signature: EMPTY_SIGNATURE,
    };

    const signatureSets = getBlockSignatureSets(
      state.config,
      state.epochCtx.currentSyncCommitteeIndexed,
      new BeaconStateView(state),
      signedBlock,
      []
    );
    // Randao reveal, block signature and the payload attestation
    expect(signatureSets.length).toBe(3);
    // The default ptcWindow is all zeros, so validator 0 fills every PTC position
    expect(signatureSets[2]).toMatchObject({type: SignatureSetType.aggregate, indices: [0]});
    expect(verifySignatureSet(signatureSets[2])).toBe(true);
  });
});

type BlockProposerData = {
  proposerIndex: ValidatorIndex;
  signature: BLSSignature;
};

function getMockProposerSlashings(data1: BlockProposerData, data2: BlockProposerData): phase0.ProposerSlashing {
  return {
    signedHeader1: getMockSignedBeaconBlockHeaderBigint(data1),
    signedHeader2: getMockSignedBeaconBlockHeaderBigint(data2),
  };
}

function getMockSignedBeaconBlockHeaderBigint(data: BlockProposerData): phase0.SignedBeaconBlockHeaderBigint {
  return {
    message: {
      slot: BigInt(0),
      proposerIndex: data.proposerIndex,
      parentRoot: ZERO_HASH,
      stateRoot: ZERO_HASH,
      bodyRoot: ZERO_HASH,
    },
    signature: data.signature,
  };
}

type IndexAttestationData = {
  attestingIndices: ValidatorIndex[];
  signature: BLSSignature;
};

function getMockAttesterSlashings(data1: IndexAttestationData, data2: IndexAttestationData): phase0.AttesterSlashing {
  return {
    attestation1: getMockIndexAttestationBn(data1),
    attestation2: getMockIndexAttestationBn(data2),
  };
}

function getMockIndexAttestationBn(data: IndexAttestationData): phase0.IndexedAttestationBigint {
  return {
    attestingIndices: data.attestingIndices,
    data: getAttestationDataBigint(),
    signature: data.signature,
  };
}

function getAttestationData(): phase0.AttestationData {
  return {
    slot: 0,
    index: 0,
    beaconBlockRoot: ZERO_HASH,
    source: {epoch: 0, root: ZERO_HASH},
    target: {epoch: 0, root: ZERO_HASH},
  };
}

function getAttestationDataBigint(): phase0.AttestationDataBigint {
  return {
    slot: BigInt(0),
    index: BigInt(0),
    beaconBlockRoot: ZERO_HASH,
    source: {epoch: BigInt(0), root: ZERO_HASH},
    target: {epoch: BigInt(0), root: ZERO_HASH},
  };
}

function getMockAttestations(bitLen: number): phase0.Attestation {
  return {
    aggregationBits: BitArray.fromSingleBit(bitLen, 0),
    data: getAttestationData(),
    signature: EMPTY_SIGNATURE,
  };
}

type SignedVoluntaryExitData = {
  signature: BLSSignature;
  validatorIndex: ValidatorIndex;
};

function getMockSignedVoluntaryExit(data: SignedVoluntaryExitData): phase0.SignedVoluntaryExit {
  return {
    message: {
      epoch: 0,
      validatorIndex: data.validatorIndex,
    },
    signature: data.signature,
  };
}

type SignedBLStoExecutionChange = {
  signature: BLSSignature;
  validatorIndex: ValidatorIndex;
};

function getMockSignedBlsToExecutionChange(data: SignedBLStoExecutionChange): capella.SignedBLSToExecutionChange {
  return {
    message: {
      validatorIndex: data.validatorIndex,
      fromBlsPubkey: Buffer.alloc(48),
      toExecutionAddress: Buffer.alloc(20),
    },
    signature: data.signature,
  };
}
