import crypto from "crypto";
import bls, {init} from "@chainsafe/bls";
import {BitList, List} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {
  BeaconBlock,
  SignedBeaconBlock,
  ProposerSlashing,
  AttesterSlashing,
  Deposit,
  SignedVoluntaryExit,
  Attestation,
  SignedBeaconBlockHeader,
  ValidatorIndex,
  BLSSignature,
  IndexedAttestation,
  AttestationData,
} from "@chainsafe/lodestar-types";
import {ZERO_HASH, FAR_FUTURE_EPOCH} from "../../../../src/constants";
import {generateState} from "../../../utils/state";
import {generateValidators} from "../../../utils/validator";
import {getAllBlockSignatureSets} from "../../../../src/fast/signatureSets";
import {EpochContext} from "../../../../src/fast";
import {expect} from "chai";

describe("signatureSets", () => {
  before("Init BLS", async () => {
    await init("blst-native");
  });

  it("should aggregate all signatures from a block", () => {
    const EMPTY_SIGNATURE = Buffer.alloc(96);

    const block: BeaconBlock = {
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
        ] as List<ProposerSlashing>,
        attesterSlashings: [
          getMockAttesterSlashings(
            {attestingIndices: [0] as List<ValidatorIndex>, signature: EMPTY_SIGNATURE},
            {attestingIndices: [0] as List<ValidatorIndex>, signature: EMPTY_SIGNATURE}
          ),
        ] as List<AttesterSlashing>,
        attestations: [
          getMockAttestations({attestingIndices: [0] as List<ValidatorIndex>, signature: EMPTY_SIGNATURE}),
        ] as List<Attestation>,
        deposits: ([] as Deposit[]) as List<Deposit>,
        voluntaryExits: [getMockSignedVoluntaryExit({validatorIndex: 0, signature: EMPTY_SIGNATURE})] as List<
          SignedVoluntaryExit
        >,
      },
    };

    const signedBlock: SignedBeaconBlock = {
      message: block,
      signature: EMPTY_SIGNATURE,
    };

    // Generate active validators
    const validators = generateValidators(32, {
      balance: config.params.MAX_EFFECTIVE_BALANCE,
      activation: 0,
      exit: FAR_FUTURE_EPOCH,
    });
    validators.forEach((validator) => {
      validator.pubkey = bls.SecretKey.fromKeygen().toPublicKey().toBytes();
    });

    // Create EpochContext with generated validators
    const epochCtx = new EpochContext(config);
    const state = generateState({validators});
    epochCtx.loadState(state);

    const signatureSets = getAllBlockSignatureSets(epochCtx, state, signedBlock);
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

function getMockProposerSlashings(data1: IBlockProposerData, data2: IBlockProposerData): ProposerSlashing {
  return {
    signedHeader1: getMockSignedBeaconBlockHeader(data1),
    signedHeader2: getMockSignedBeaconBlockHeader(data2),
  };
}

function getMockSignedBeaconBlockHeader(data: IBlockProposerData): SignedBeaconBlockHeader {
  return {
    message: {
      slot: 0,
      proposerIndex: data.proposerIndex,
      parentRoot: ZERO_HASH,
      stateRoot: ZERO_HASH,
      bodyRoot: ZERO_HASH,
    },
    signature: data.signature,
  };
}

interface IIndexAttestationData {
  attestingIndices: List<ValidatorIndex>;
  signature: BLSSignature;
}

function getMockAttesterSlashings(data1: IIndexAttestationData, data2: IIndexAttestationData): AttesterSlashing {
  return {
    attestation1: getMockIndexAttestation(data1),
    attestation2: getMockIndexAttestation(data2),
  };
}

function getMockIndexAttestation(data: IIndexAttestationData): IndexedAttestation {
  return {
    attestingIndices: data.attestingIndices,
    data: getAttestationData(),
    signature: data.signature,
  };
}

function getAttestationData(): AttestationData {
  return {
    slot: 0,
    index: 0,
    beaconBlockRoot: ZERO_HASH,
    source: {
      epoch: 0,
      root: ZERO_HASH,
    },
    target: {
      epoch: 0,
      root: ZERO_HASH,
    },
  };
}

function getMockAttestations(data: IIndexAttestationData): Attestation {
  return {
    aggregationBits: [true] as BitList,
    data: getAttestationData(),
    signature: data.signature,
  };
}

interface ISignedVoluntaryExitData {
  signature: BLSSignature;
  validatorIndex: ValidatorIndex;
}

function getMockSignedVoluntaryExit(data: ISignedVoluntaryExitData): SignedVoluntaryExit {
  return {
    message: {
      epoch: 0,
      validatorIndex: data.validatorIndex,
    },
    signature: data.signature,
  };
}
