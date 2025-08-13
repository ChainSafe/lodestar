import {ChainForkConfig} from "@lodestar/config";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {deneb} from "@lodestar/types";
import {LodestarError, fromHex, prettyBytes, toHex} from "@lodestar/utils";
import {BlockInputSource, DAType, IBlockInput, isBlockInputBlobs} from "../../chain/blocks/blockInput/index.js";
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

  if (!pending.blockInput.hasAllData()) {
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
  const blockRootHex = getBlockInputSyncCacheItemRootHex(pending);
  const blockRoot = fromHex(blockRootHex);
  const [response] = await network.sendBeaconBlocksByRoot(peerIdStr, [blockRoot]);
  if (isPendingBlockInput(pending)) {
    pending.blockInput.addBlock({
      blockRootHex,
      block: response.data,
      source: {
        seenTimestampSec: Date.now() / 1000,
        source: BlockInputSource.byRoot,
        peerIdStr,
      },
    });
    return pending;
  }

  const blockInput = cache.getByBlock({
    block: response.data,
    source: BlockInputSource.byRoot,
    seenTimestampSec: Date.now() / 1000,
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
}: Omit<DownloadBlockInputByRootProps, "cache" | "pending"> & {blockInput: IBlockInput}): Promise<void> {
  if (isBlockInputBlobs(blockInput)) {
    const missingBlobsMeta = blockInput.getMissingBlobMeta();
    if (executionEngine) {
      const forkName = blockInput.forkName;
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
            blockRootHex: blockInput.blockRootHex,
            seenTimestampSec: Date.now() / 1000,
            source: BlockInputSource.engine,
          });
        }
      }

      if (blockInput.hasAllData()) {
        return;
      }
    }

    const response = await network.sendBlobSidecarsByRoot(
      peerIdStr,
      missingBlobsMeta.map(({blockRoot, index}) => ({blockRoot, index}))
    );
    const seenTimestampSec = Date.now() / 1000;

    for (const blobSidecar of response) {
      const blockRoot = config
        .getForkTypes(blobSidecar.signedBlockHeader.message.slot)
        .BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
      blockInput.addBlob({
        blobSidecar,
        peerIdStr,
        seenTimestampSec,
        blockRootHex: toHex(blockRoot),
        source: BlockInputSource.byRoot,
      });
    }

    return;
  }

  throw new DownloadByRootError({
    code: DownloadByRootErrorCode.INVALID_BLOCK_INPUT_TYPE,
    blockRoot: prettyBytes(blockInput.blockRootHex),
    type: blockInput.type,
  });
}

export enum DownloadByRootErrorCode {
  INVALID_BLOCK_INPUT_TYPE = "DOWNLOAD_BY_ROOT_ERROR_INVALID_BLOCK_INPUT_TYPE",
  BLOCK_NOT_DOWNLOADED = "DOWNLOAD_BY_ROOT_ERROR_BLOCK_NOT_DOWNLOADED",
}
export type DownloadByRootErrorType =
  | {
      code: DownloadByRootErrorCode.INVALID_BLOCK_INPUT_TYPE;
      blockRoot: string;
      type: DAType;
    }
  | {
      code: DownloadByRootErrorCode.BLOCK_NOT_DOWNLOADED;
      blockRoot: string;
    };

export class DownloadByRootError extends LodestarError<DownloadByRootErrorType> {}
