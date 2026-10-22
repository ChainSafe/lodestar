import {ProtoBlock} from "@lodestar/fork-choice";
import {Root} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {ChainViewBlock} from "../chainView/interface.js";

export function toChainViewBlock(block: ProtoBlock): ChainViewBlock {
  return {
    blockRoot: block.blockRoot,
    slot: block.slot,
    parentRoot: block.parentRoot,
    stateRoot: block.stateRoot,
    parentBlockHash: block.parentBlockHash,
    payloadStatus: block.payloadStatus,
    executionPayloadBlockHash: block.executionPayloadBlockHash,
    executionPayloadNumber: "executionPayloadNumber" in block ? block.executionPayloadNumber : undefined,
  };
}

export function toChainViewBlockBytes(block: ProtoBlock): ChainViewBlock<Root> {
  return {
    ...toChainViewBlock(block),
    blockRoot: fromHex(block.blockRoot),
    parentRoot: fromHex(block.parentRoot),
    stateRoot: fromHex(block.stateRoot),
    parentBlockHash: block.parentBlockHash === null ? null : fromHex(block.parentBlockHash),
    executionPayloadBlockHash:
      block.executionPayloadBlockHash === null ? null : fromHex(block.executionPayloadBlockHash),
  };
}

export function fromChainViewBlockBytes(block: ChainViewBlock<Root>): ChainViewBlock {
  return {
    ...block,
    blockRoot: toRootHex(block.blockRoot),
    parentRoot: toRootHex(block.parentRoot),
    stateRoot: toRootHex(block.stateRoot),
    parentBlockHash: block.parentBlockHash === null ? null : toRootHex(block.parentBlockHash),
    executionPayloadBlockHash:
      block.executionPayloadBlockHash === null ? null : toRootHex(block.executionPayloadBlockHash),
  };
}
