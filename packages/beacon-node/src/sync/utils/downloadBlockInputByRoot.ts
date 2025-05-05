import {ChainForkConfig} from "@lodestar/config";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {deneb} from "@lodestar/types";
import {LodestarError, toHex} from "@lodestar/utils";
import {
  BlockInput,
  BlockInputDataStatus,
  BlockInputSource,
  BlockInputType,
  getDataAvailabilityStatus,
  isBlockInputBlobs,
} from "../../chain/blocks/blockInput/index.js";
import {IExecutionEngine} from "../../execution/index.js";
import {INetwork} from "../../network/index.js";
import {computeInclusionProof} from "../../util/blobs.js";
import {PeerIdStr} from "../../util/peerId.js";

export type DownloadBlockInputByRootProps = {
  config: ChainForkConfig;
  network: INetwork;
  executionEngine?: IExecutionEngine;
  blockInput: BlockInput;
  peerIdStr: PeerIdStr;
};

export async function downloadBlockInputByRoot({
  config,
  network,
  executionEngine,
  blockInput,
  peerIdStr,
}: DownloadBlockInputByRootProps): Promise<void> {
  if (!blockInput.hasBlock()) {
    await downloadAndCacheBlock({
      network,
      blockInput,
      peerIdStr,
    });
  }

  if (blockInput.needsData()) {
    await downloadAndCacheData({
      config,
      network,
      executionEngine,
      peerIdStr,
      blockInput,
    });
  }
}

export async function downloadAndCacheBlock({
  network,
  blockInput,
  peerIdStr,
}: Omit<DownloadBlockInputByRootProps, "config" | "executionEngine">): Promise<void> {
  const [response] = await network.sendBeaconBlocksByRoot(peerIdStr, [blockInput.blockRoot]);
  blockInput.addBlock({
    peerIdStr,
    block: response.data,
    seenTimestampSec: Date.now(),
    source: BlockInputSource.byRoot,
  });
}

export async function downloadAndCacheData({
  config,
  network,
  executionEngine,
  blockInput,
  peerIdStr,
}: DownloadBlockInputByRootProps): Promise<void> {
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

  Z = "DOWNLOAD_BY_ROOT_ERROR_Z",
}

export type DownloadByRootErrorType = {
  code: DownloadByRootErrorCode.INVALID_BLOCK_INPUT_TYPE;
  blockRoot: string;
  type: BlockInputType;
};

export class DownloadByRootError extends LodestarError<DownloadByRootErrorType> {}
