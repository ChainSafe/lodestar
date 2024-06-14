import {ChainForkConfig} from "@lodestar/config";
import {ForkExecution, ForkSeq} from "@lodestar/params";
import {
  Root,
  isBlindedBeaconBlock,
  isExecutionPayloadAndBlobsBundle,
  BeaconBlock,
  BeaconBlockHeader,
  SignedBeaconBlock,
  ExecutionPayload,
  ExecutionPayloadAndBlobsBundle,
  BlobsBundle,
  SignedBeaconBlockOrContents,
  Contents,
  SignedBlindedBeaconBlock,
  BlindedBeaconBlock,
  BlindedExecutionPayload,
} from "@lodestar/types";

import {executionPayloadToPayloadHeader} from "./execution.js";

export function blindedOrFullBlockHashTreeRoot(
  config: ChainForkConfig,
  blindedOrFull: BeaconBlock | BlindedBeaconBlock
): Root {
  return isBlindedBeaconBlock(blindedOrFull)
    ? // Blinded
      config.getBlindedForkTypes(blindedOrFull.slot).BeaconBlock.hashTreeRoot(blindedOrFull)
    : // Full
      config.getForkTypes(blindedOrFull.slot).BeaconBlock.hashTreeRoot(blindedOrFull);
}

export function blindedOrFullBlockToHeader(
  config: ChainForkConfig,
  blindedOrFull: BeaconBlock | BlindedBeaconBlock
): BeaconBlockHeader {
  const bodyRoot = isBlindedBeaconBlock(blindedOrFull)
    ? // Blinded
      config.getBlindedForkTypes(blindedOrFull.slot).BeaconBlockBody.hashTreeRoot(blindedOrFull.body)
    : // Full
      config.getForkTypes(blindedOrFull.slot).BeaconBlockBody.hashTreeRoot(blindedOrFull.body);

  return {
    slot: blindedOrFull.slot,
    proposerIndex: blindedOrFull.proposerIndex,
    parentRoot: blindedOrFull.parentRoot,
    stateRoot: blindedOrFull.stateRoot,
    bodyRoot,
  };
}

export function beaconBlockToBlinded(config: ChainForkConfig, block: BeaconBlock<ForkExecution>): BlindedBeaconBlock {
  const fork = config.getForkName(block.slot);
  const executionPayloadHeader = executionPayloadToPayloadHeader(ForkSeq[fork], block.body.executionPayload);
  const blindedBlock = {...block, body: {...block.body, executionPayloadHeader}} as BlindedBeaconBlock;
  return blindedBlock;
}

export function signedBlindedBlockToFull(
  signedBlindedBlock: SignedBlindedBeaconBlock,
  executionPayload: ExecutionPayload | null
): SignedBeaconBlock {
  const signedBlock = {
    ...signedBlindedBlock,
    message: {
      ...signedBlindedBlock.message,
      body: {
        ...signedBlindedBlock.message.body,
        // state transition doesn't handle null value for executionPayload in pre-bellatrix blocks
        executionPayload: executionPayload ?? undefined,
      },
    },
  } as SignedBeaconBlock;

  // state transition can't seem to handle executionPayloadHeader presense in merge block
  // so just delete the extra field we don't require
  delete (signedBlock.message.body as {executionPayloadHeader?: BlindedExecutionPayload}).executionPayloadHeader;
  return signedBlock;
}

export function parseExecutionPayloadAndBlobsBundle(data: ExecutionPayload | ExecutionPayloadAndBlobsBundle): {
  executionPayload: ExecutionPayload;
  blobsBundle: BlobsBundle | null;
} {
  if (isExecutionPayloadAndBlobsBundle(data)) {
    return data;
  } else {
    return {
      executionPayload: data,
      blobsBundle: null,
    };
  }
}

export function reconstructFullBlockOrContents(
  signedBlindedBlock: SignedBlindedBeaconBlock,
  {
    executionPayload,
    contents,
  }: {
    executionPayload: ExecutionPayload | null;
    contents: Contents | null;
  }
): SignedBeaconBlockOrContents {
  const signedBlock = signedBlindedBlockToFull(signedBlindedBlock, executionPayload);

  if (contents !== null) {
    if (executionPayload === null) {
      throw Error("Missing locally produced executionPayload for deneb+ publishBlindedBlock");
    }

    return {signedBlock, ...contents} as SignedBeaconBlockOrContents;
  } else {
    return signedBlock as SignedBeaconBlockOrContents;
  }
}
