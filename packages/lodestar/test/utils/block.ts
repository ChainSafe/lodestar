import {ssz} from "@chainsafe/lodestar-types";
import {config as defaultConfig} from "@chainsafe/lodestar-config/default";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {IProtoBlock, ExecutionStatus} from "@chainsafe/lodestar-fork-choice";
import {isPlainObject} from "@chainsafe/lodestar-utils";
import {RecursivePartial} from "@chainsafe/lodestar-utils";
import deepmerge from "deepmerge";
import {EMPTY_SIGNATURE, ZERO_HASH} from "../../src/constants";
import {ReqRespBlockResponse} from "../../src/network/reqresp/types";

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
      proposerSlashings: ([] as phase0.ProposerSlashing[]) as List<phase0.ProposerSlashing>,
      attesterSlashings: ([] as phase0.AttesterSlashing[]) as List<phase0.AttesterSlashing>,
      attestations: ([] as phase0.Attestation[]) as List<phase0.Attestation>,
      deposits: ([] as phase0.Deposit[]) as List<phase0.Deposit>,
      voluntaryExits: ([] as phase0.SignedVoluntaryExit[]) as List<phase0.SignedVoluntaryExit>,
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

export function generateEmptyProtoBlock(): IProtoBlock {
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

    ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
  };
}

export function generateProtoBlock(overrides: RecursivePartial<IProtoBlock> = {}): IProtoBlock {
  return deepmerge<IProtoBlock, RecursivePartial<IProtoBlock>>(generateEmptyProtoBlock(), overrides, {
    isMergeableObject: isPlainObject,
  });
}
