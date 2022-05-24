import crypto from "node:crypto";
import bls from "@chainsafe/bls";
import {config} from "@chainsafe/lodestar-config/default";
import {ValidatorIndex, BLSSignature} from "@chainsafe/lodestar-types";
import {ZERO_HASH} from "../../../src/constants/index.js";
import {generateCachedState} from "../../utils/state.js";
import {generateValidators} from "../../utils/validator.js";
import {expect} from "chai";
import {phase0, allForks} from "../../../src/index.js";
import {FAR_FUTURE_EPOCH, MAX_EFFECTIVE_BALANCE} from "@chainsafe/lodestar-params";
import {BitArray} from "@chainsafe/ssz";

const EMPTY_SIGNATURE = Buffer.alloc(96);

describe("signatureSets", () => {
  it("should aggregate all signatures from a block", () => {
    const block: phase0.BeaconBlock = {
      slot: 0,
      proposerIndex: 0,
      parentRoot: crypto.randomBytes(32),
      stateRoot: ZERO_HASH,
      body: {
        randaoReveal: Buffer.alloc(96),
        eth1Data: {
          depositRoot: crypto.randomBytes(32),
          blockHash: crypto.randomBytes(32),
          depositCount: 0,
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
      },
    };

    const signedBlock: phase0.SignedBeaconBlock = {
      message: block,
      signature: EMPTY_SIGNATURE,
    };

    // Generate active validators
    const validators = generateValidators(32, {
      balance: MAX_EFFECTIVE_BALANCE,
      activation: 0,
      exit: FAR_FUTURE_EPOCH,
    });
    for (const validator of validators) {
      validator.pubkey = bls.SecretKey.fromKeygen().toPublicKey().toBytes();
    }

    const state = generateCachedState(config, {validators});

    const signatureSets = allForks.getAllBlockSignatureSets(state, signedBlock);
    expect(signatureSets.length).to.equal(
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
});

interface IBlockProposerData {
  proposerIndex: ValidatorIndex;
  signature: BLSSignature;
}

function getMockProposerSlashings(data1: IBlockProposerData, data2: IBlockProposerData): phase0.ProposerSlashing {
  return {
    signedHeader1: getMockSignedBeaconBlockHeaderBigint(data1),
    signedHeader2: getMockSignedBeaconBlockHeaderBigint(data2),
  };
}

function getMockSignedBeaconBlockHeaderBigint(data: IBlockProposerData): phase0.SignedBeaconBlockHeaderBigint {
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

interface IIndexAttestationData {
  attestingIndices: ValidatorIndex[];
  signature: BLSSignature;
}

function getMockAttesterSlashings(data1: IIndexAttestationData, data2: IIndexAttestationData): phase0.AttesterSlashing {
  return {
    attestation1: getMockIndexAttestationBn(data1),
    attestation2: getMockIndexAttestationBn(data2),
  };
}

function getMockIndexAttestationBn(data: IIndexAttestationData): phase0.IndexedAttestationBigint {
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

interface ISignedVoluntaryExitData {
  signature: BLSSignature;
  validatorIndex: ValidatorIndex;
}

function getMockSignedVoluntaryExit(data: ISignedVoluntaryExitData): phase0.SignedVoluntaryExit {
  return {
    message: {
      epoch: 0,
      validatorIndex: data.validatorIndex,
    },
    signature: data.signature,
  };
}
