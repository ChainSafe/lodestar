import deepmerge from "deepmerge";
import {ssz} from "@lodestar/types";
import {config as defaultConfig} from "@lodestar/config/default";
import {IChainForkConfig} from "@lodestar/config";
import {allForks, phase0} from "@lodestar/types";
import {ProtoBlock, ExecutionStatus} from "@lodestar/fork-choice";
import {isPlainObject} from "@lodestar/utils";
import {RecursivePartial} from "@lodestar/utils";
import {EMPTY_SIGNATURE, ZERO_HASH} from "../../src/constants/index.js";
import {ReqRespBlockResponse} from "../../src/network/reqresp/types.js";

export function generateEmptyBlock(): phase0.BeaconBlock {
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
      proposerSlashings: [],
      attesterSlashings: [],
      attestations: [],
      deposits: [],
      voluntaryExits: [],
    },
  };
}

export function generateEmptySignedBlock(): phase0.SignedBeaconBlock {
  return {
    message: generateEmptyBlock(),
    signature: EMPTY_SIGNATURE,
  };
}

export function generateEmptyReqRespBlockResponse(): ReqRespBlockResponse {
  return {
    slot: 0,
    bytes: Buffer.from(ssz.phase0.SignedBeaconBlock.serialize(generateEmptySignedBlock())),
  };
}

export function blocksToReqRespBlockResponses(
  blocks: allForks.SignedBeaconBlock[],
  config?: IChainForkConfig
): ReqRespBlockResponse[] {
  return blocks.map((block) => {
    const slot = block.message.slot;
    const sszType = config
      ? config.getForkTypes(slot).SignedBeaconBlock
      : defaultConfig.getForkTypes(slot).SignedBeaconBlock;
    return {
      slot,
      bytes: Buffer.from(sszType.serialize(block)),
    };
  });
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
