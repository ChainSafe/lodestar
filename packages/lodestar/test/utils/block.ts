import {
  BeaconBlock,
  SignedBeaconBlock,
  ProposerSlashing,
  AttesterSlashing,
  Attestation,
  Deposit,
  SignedVoluntaryExit
} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {EMPTY_SIGNATURE, ZERO_HASH} from "../../src/constants";
import {BlockSummary} from "../../src/chain";
import deepmerge from "deepmerge";
import {isPlainObject} from "@chainsafe/lodestar-utils";
import {DeepPartial} from "./misc";


export function generateEmptyBlock(): BeaconBlock {
  return {
    slot: 0,
    proposerIndex: 0,
    parentRoot: Buffer.alloc(32),
    stateRoot: ZERO_HASH,
    body: {
      randaoReveal: Buffer.alloc(96),
      eth1Data: {
        depositRoot: Buffer.alloc(32),
        blockHash: Buffer.alloc(32),
        depositCount: 0,
      },
      graffiti: Buffer.alloc(32),
      proposerSlashings: [] as ProposerSlashing[] as List<ProposerSlashing>,
      attesterSlashings: [] as AttesterSlashing[] as List<AttesterSlashing>,
      attestations: [] as Attestation[] as List<Attestation>,
      deposits: [] as Deposit[] as List<Deposit>,
      voluntaryExits: [] as SignedVoluntaryExit[] as List<SignedVoluntaryExit>,
    },
  };
}

export function generateEmptySignedBlock(): SignedBeaconBlock {
  return {
    message: generateEmptyBlock(),
    signature: EMPTY_SIGNATURE,
  };
}

export function generateSignedBlock(override: DeepPartial<SignedBeaconBlock> = {}): SignedBeaconBlock {
  return deepmerge<SignedBeaconBlock, DeepPartial<SignedBeaconBlock>>(
    generateEmptySignedBlock(),
    override,
    {isMergeableObject: isPlainObject}
  );
}

export function generateEmptyBlockSummary(): BlockSummary {
  return {
    blockRoot: Buffer.alloc(32),
    parentRoot: Buffer.alloc(32),
    slot: 0,
    stateRoot: Buffer.alloc(32),
    justifiedCheckpoint: {root: Buffer.alloc(32), epoch: 0},
    finalizedCheckpoint: {root: Buffer.alloc(32), epoch: 0},
  };
}

export function generateBlockSummary(overrides: DeepPartial<BlockSummary> = {}): BlockSummary {
  return deepmerge<BlockSummary, DeepPartial<BlockSummary>>(
    generateEmptyBlockSummary(),
    overrides,
    {isMergeableObject: isPlainObject}
  );
}
