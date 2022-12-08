import deepmerge from "deepmerge";
import {Slot} from "@lodestar/types";
import {phase0} from "@lodestar/types";
import {ProtoBlock, ExecutionStatus} from "@lodestar/fork-choice";
import {isPlainObject} from "@lodestar/utils";
import {RecursivePartial} from "@lodestar/utils";
import {EMPTY_SIGNATURE, ZERO_HASH} from "../../src/constants/index.js";

export function generateEmptyBlock(slot: Slot = 0): phase0.BeaconBlock {
  return {
    slot,
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
      proposerSlashings: [],
      attesterSlashings: [],
      attestations: [],
      deposits: [],
      voluntaryExits: [],
    },
  };
}

export function generateEmptySignedBlock(slot: Slot = 0): phase0.SignedBeaconBlock {
  return {
    message: generateEmptyBlock(slot),
    signature: EMPTY_SIGNATURE,
  };
}

export function generateEmptySignedBlockHeader(): phase0.SignedBeaconBlockHeader {
  return {
    message: {
      slot: 0,
      proposerIndex: 0,
      parentRoot: Buffer.alloc(32),
      stateRoot: Buffer.alloc(32),
      bodyRoot: Buffer.alloc(32),
    },
    signature: EMPTY_SIGNATURE,
  };
}

export function generateSignedBlockHeaderBn(): phase0.SignedBeaconBlockHeaderBigint {
  return {
    message: {
      slot: BigInt(0),
      proposerIndex: 0,
      parentRoot: Buffer.alloc(32),
      stateRoot: Buffer.alloc(32),
      bodyRoot: Buffer.alloc(32),
    },
    signature: EMPTY_SIGNATURE,
  };
}

export function generateSignedBlock(
  override: RecursivePartial<phase0.SignedBeaconBlock> = {}
): phase0.SignedBeaconBlock {
  return deepmerge<phase0.SignedBeaconBlock, RecursivePartial<phase0.SignedBeaconBlock>>(
    generateEmptySignedBlock(),
    override,
    {
      isMergeableObject: isPlainObject,
    }
  );
}

export function generateEmptyProtoBlock(): ProtoBlock {
  const rootHex = "0x" + "00".repeat(32);
  return {
    slot: 0,
    blockRoot: rootHex,
    parentRoot: rootHex,
    stateRoot: rootHex,
    targetRoot: rootHex,

    justifiedEpoch: 0,
    justifiedRoot: rootHex,
    finalizedEpoch: 0,
    finalizedRoot: rootHex,
    unrealizedJustifiedEpoch: 0,
    unrealizedJustifiedRoot: rootHex,
    unrealizedFinalizedEpoch: 0,
    unrealizedFinalizedRoot: rootHex,

    ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
  };
}

export function generateProtoBlock(overrides: RecursivePartial<ProtoBlock> = {}): ProtoBlock {
  return deepmerge<ProtoBlock, RecursivePartial<ProtoBlock>>(generateEmptyProtoBlock(), overrides, {
    isMergeableObject: isPlainObject,
  });
}
