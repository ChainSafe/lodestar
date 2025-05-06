import {ChainForkConfig} from "@lodestar/config";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {deneb} from "@lodestar/types";
import {LodestarError, fromHex, toHex} from "@lodestar/utils";
import {
  BlockInput,
  BlockInputDataStatus,
  BlockInputSource,
  BlockInputType,
  getDataAvailabilityStatus,
  isBlockInputBlobs,
} from "../../chain/blocks/blockInput/index.js";
import {SeenBlockInputCache} from "../../chain/seenCache/seenBlockInput.js";
import {IExecutionEngine} from "../../execution/index.js";
import {INetwork} from "../../network/index.js";
import {computeInclusionProof} from "../../util/blobs.js";
import {PeerIdStr} from "../../util/peerId.js";
import {
  BlockInputSyncCacheItem,
  PendingBlockInput,
  getBlockInputSyncCacheItemRootHex,
  isPendingBlockInput,
} from "../types.js";

export type DownloadBlockInputByRootProps = {
  config: ChainForkConfig;
  network: INetwork;
  cache: SeenBlockInputCache;
  executionEngine?: IExecutionEngine;
  pending: BlockInputSyncCacheItem;
  peerIdStr: PeerIdStr;
};

export async function downloadBlockInputByRoot({
  config,
  network,
  cache,
  executionEngine,
  pending,
  peerIdStr,
}: DownloadBlockInputByRootProps): Promise<PendingBlockInput> {
  if (!isPendingBlockInput(pending) || !pending.blockInput.hasBlock()) {
    pending = await downloadAndCacheBlock({
      network,
      cache,
      pending,
      peerIdStr,
    });
  }

  if (pending.blockInput.needsData()) {
    await downloadAndCacheData({
      config,
      network,
      executionEngine,
      peerIdStr,
      blockInput: pending.blockInput,
    });
  }

  return pending;
}

export async function downloadAndCacheBlock({
  network,
  cache,
  pending,
  peerIdStr,
}: Omit<DownloadBlockInputByRootProps, "config" | "executionEngine">): Promise<PendingBlockInput> {
  const rootHex = getBlockInputSyncCacheItemRootHex(pending);
  const blockRoot = fromHex(rootHex);
  const [response] = await network.sendBeaconBlocksByRoot(peerIdStr, [blockRoot]);
  if (isPendingBlockInput(pending)) {
    pending.blockInput.addBlock({
      peerIdStr,
      block: response.data,
      seenTimestampSec: Date.now(),
      source: BlockInputSource.byRoot,
    });
    return pending;
  }

  const blockInput = cache.getBlockInputByBlock({
    block: response.data,
    blockRoot,
    seenTimestampSec: Date.now(),
    source: BlockInputSource.byRoot,
    peerIdStr,
  });
  return {
    status: pending.status,
    blockInput,
    timeAddedSec: pending.timeAddedSec,
    peerIdStrings: pending.peerIdStrings,
    timeSyncedSec: pending.timeSyncedSec,
  };
}

export async function downloadAndCacheData({
  config,
  network,
  executionEngine,
  blockInput,
  peerIdStr,
}: Omit<DownloadBlockInputByRootProps, "cache" | "pending"> & {blockInput: BlockInput}): Promise<void> {
  if (isBlockInputBlobs(blockInput)) {
    const missingBlobsMeta = blockInput.getMissingBlobMeta();
    if (executionEngine) {
      const forkName = blockInput.getForkName();
      const response = await executionEngine.getBlobs(
        forkName,
        missingBlobsMeta.map(({versionHash}) => versionHash)
      );
      const signedBeaconBlock = blockInput.getBlock();
      const blockBody = signedBeaconBlock.message.body;
      for (const [requestIndex, blobAndProof] of response.entries()) {
        if (blobAndProof) {
          const {blob, proof} = blobAndProof;
          const {index} = missingBlobsMeta[requestIndex];
          const kzgCommitmentInclusionProof = computeInclusionProof(forkName, blockBody, index);
          const blobSidecar: deneb.BlobSidecar = {
            blob,
            index,
            kzgProof: proof,
            kzgCommitment: blockBody.blobKzgCommitments[index],
            kzgCommitmentInclusionProof,
            signedBlockHeader: signedBlockToSignedHeader(config, signedBeaconBlock),
          };
          blockInput.addBlob({
            blobSidecar,
            rootHex: blockInput.rootHex,
            seenTimestampSec: Date.now(),
            source: BlockInputSource.engine,
          });
        }
      }

      if (!blockInput.needsData()) {
        return;
      }
    }

    const response = await network.sendBlobSidecarsByRoot(
      peerIdStr,
      missingBlobsMeta.map(({blockRoot, index}) => ({blockRoot, index}))
    );
    const seenTimestampSec = Date.now();

    for (const blobSidecar of response) {
      const blockRoot = config
        .getForkTypes(blobSidecar.signedBlockHeader.message.slot)
        .BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
      blockInput.addBlob({
        peerIdStr,
        blobSidecar,
        seenTimestampSec,
        rootHex: toHex(blockRoot),
        source: BlockInputSource.byRoot,
      });
    }

    return;
  }

  throw new DownloadByRootError({
    code: DownloadByRootErrorCode.INVALID_BLOCK_INPUT_TYPE,
    blockRoot: blockInput.prettyRootHex,
    type: blockInput.type,
  });
}

export enum DownloadByRootErrorCode {
  INVALID_BLOCK_INPUT_TYPE = "DOWNLOAD_BY_ROOT_ERROR_INVALID_BLOCK_INPUT_TYPE",
  BLOCK_NOT_DOWNLOADED = "DOWNLOAD_BY_ROOT_ERROR_BLOCK_NOT_DOWNLOADED",

  Z = "DOWNLOAD_BY_ROOT_ERROR_Z",
}
export type DownloadByRootErrorType =
  | {
      code: DownloadByRootErrorCode.INVALID_BLOCK_INPUT_TYPE;
      blockRoot: string;
      type: BlockInputType;
    }
  | {
      code: DownloadByRootErrorCode.BLOCK_NOT_DOWNLOADED;
      blockRoot: string;
    };

export class DownloadByRootError extends LodestarError<DownloadByRootErrorType> {}
