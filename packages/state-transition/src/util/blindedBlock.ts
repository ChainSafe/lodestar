import {ChainForkConfig} from "@lodestar/config";
import {ForkAll, ForkExecution, ForkSeq} from "@lodestar/params";
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
  FullOrBlinded,
} from "@lodestar/types";

import {executionPayloadToPayloadHeader} from "./execution.js";

export function blindedOrFullBlockHashTreeRoot(
  config: ChainForkConfig,
  blindedOrFull: BeaconBlock<ForkAll, FullOrBlinded>
): Root {
  return isBlindedBeaconBlock(blindedOrFull)
    ? // Blinded
      config.getBlindedForkTypes(blindedOrFull.slot).BeaconBlock.hashTreeRoot(blindedOrFull)
    : // Full
      config.getForkTypes(blindedOrFull.slot).BeaconBlock.hashTreeRoot(blindedOrFull);
}

export function blindedOrFullBlockToHeader(
  config: ChainForkConfig,
  blindedOrFull: BeaconBlock<ForkAll, FullOrBlinded>
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

export function beaconBlockToBlinded(
  config: ChainForkConfig,
  block: BeaconBlock<ForkExecution>
): BeaconBlock<ForkExecution, "blinded"> {
  const fork = config.getForkName(block.slot);
  const executionPayloadHeader = executionPayloadToPayloadHeader(ForkSeq[fork], block.body.executionPayload);
  const blindedBlock = {...block, body: {...block.body, executionPayloadHeader}} as BeaconBlock<
    ForkExecution,
    "blinded"
  >;
  return blindedBlock;
}

export function signedBlindedBlockToFull(
  signedBlindedBlock: SignedBeaconBlock<ForkExecution, "blinded">,
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
  delete (signedBlock.message.body as {executionPayloadHeader?: ExecutionPayload<ForkExecution, "blinded">})
    .executionPayloadHeader;
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
  signedBlindedBlock: SignedBeaconBlock<ForkExecution, "blinded">,
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
