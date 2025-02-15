import {ChainForkConfig} from "@lodestar/config";
import {ForkName, isForkBlobs, isForkPostFulu} from "@lodestar/params";
import {deneb, fulu, RootHex, SignedBeaconBlock} from "@lodestar/types";
import {LodestarError, Logger, toHex} from "@lodestar/utils";
import {
  BlockInput,
  BlockInputBlobs,
  BlockInputColumns,
  BlockInputPreDeneb,
  BlockInputSource,
  BlockInputType,
} from "./blockInput.js";
import {CustodyConfig} from "../../../util/dataColumns.js";
import {Metrics} from "../../../metrics/metrics.js";

export class BlockInputCache {
  private blockInputs = new Map<RootHex, BlockInput<unknown>>();

  constructor(
    private config: ChainForkConfig,
    private custodyConfig: CustodyConfig,
    private logger?: Logger,
    private metrics?: Metrics
  ) {}

  getBlockInputByRootHex(rootHex: string): BlockInput {
    let blockInput = this.blockInputs.get(rootHex);
    if (!blockInput) {
      blockInput = BlockInputPreDeneb.createFromRootHex(rootHex);
      this.blockInputs.set(rootHex, blockInput);
    }
    return blockInput;
  }

  getBlockInputByBlock(blockRoot: Uint8Array, block: SignedBeaconBlock): BlockInput {
    const blockRoot = toHex(this.config.getForkTypes(block.message.slot).SignedBeaconBlock.hashTreeRoot(block.message));
    let blockInput = this.blockInputs.get(blockRoot);
    if (blockInput) {
      if (blockInput.hasBlock()) {
        // TODO: add a metric here
      } else {
        blockInput.addBlock(block);
      }
      return blockInput;
    }

    if (isForkBlobs(forkName)) {
      blockInput = BlockInputBlobs.createFromBlock(this.config, block);
    } else if (isForkPostFulu(forkName)) {
      blockInput = BlockInputColumns.createFromBlock(this.config, block);
    } else {
      blockInput = BlockInputPreDeneb.createFromBlock(this.config, block);
    }

    this.blockInputs.set(blockRoot, blockInput);
    return blockInput;
  }

  getBlockInputByBlob({
    blockRoot,
    blobSidecar,
    source,
    peerIdStr,
  }: {
    blockRoot: Uint8Array;
    blobSidecar: deneb.BlobSidecar;
    source: BlockInputSource;
    peerIdStr: string;
  }): BlockInputBlobs {
    const blockHex = toHex(blockRoot);
    let blockInput = this.blockInputs.get(blockHex) as BlockInputBlobs;
    if (blockInput) {
      if (blockInput.type !== BlockInputType.Blobs) {
        throw new BlockInputCacheError(
          {
            code: BlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE,
            cachedType: blockInput.type,
            requestedType: BlockInputType.Blobs,
          },
          `BlockInputType mismatch for slot=${blobSidecar.signedBlockHeader.message.slot} blockRoot=${blockHex}`
        );
      }
      blockInput.addBlob(this.config, blobSidecar);
    } else {
      blockInput = BlockInputBlobs.createFromBlobSidecar({
        config,
        metrics,
        abortSignal,
        blockRoot,
        blobSidecar,
        source,
        peerIdStr,
      });
      this.blockInputs.set(blockHex, blockInput);
    }

    return blockInput;
  }

  getBlockInputByColumn(forkName: ForkName, columnSidecar: fulu.DataColumnSidecar): BlockInputColumns {
    const blockRoot = toHex(
      this.config
        .getForkTypes(columnSidecar.signedBlockHeader.message.slot)
        .BeaconBlockHeader.hashTreeRoot(columnSidecar.signedBlockHeader.message)
    );

    let blockInput = this.blockInputs.get(blockRoot) as BlockInputColumns;
    if (blockInput) {
      if (blockInput.type !== BlockInputType.Blobs) {
        throw new BlockInputCacheError(
          {
            code: BlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE,
            cachedType: blockInput.type,
            requestedType: BlockInputType.Columns,
          },
          `BlockInputType mismatch for slot=${columnSidecar.signedBlockHeader.message.slot} blockRoot=${blockRoot}`
        );
      }
      blockInput.addColumnSidecar(this.config, columnSidecar);
    } else {
      blockInput = BlockInputColumns.createFromColumnSidecar(this.config, columnSidecar);
      this.blockInputs.set(blockRoot, blockInput);
    }

    return blockInput;
  }
}

enum BlockInputCacheErrorCode {
  WRONG_BLOCK_INPUT_TYPE = "BLOCK_PROCESS_INPUT_CACHE_ERROR_WRONG_BLOCK_INPUT_TYPE",
}

type BlockInputCacheErrorType = {
  code: BlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE;
  cachedType: BlockInputType;
  requestedType: BlockInputType;
};

class BlockInputCacheError extends LodestarError<BlockInputCacheErrorType> {}
