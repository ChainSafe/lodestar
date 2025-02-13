import {ChainForkConfig} from "@lodestar/config";
import {ForkName, isForkBlobs, isForkPostFulu} from "@lodestar/params";
import {deneb, fulu, RootHex, SignedBeaconBlock} from "@lodestar/types";
import {LodestarError, Logger, toHex} from "@lodestar/utils";
import {BlockInput, BlockInputBlobs, BlockInputColumns, BlockInputPreDeneb, BlockInputType} from "./blockInput.js";
import {CustodyConfig} from "../../../util/dataColumns.js";
import {Metrics} from "../../../metrics/metrics.js";

export class SeenBlockInputCache {
  private blockInputs = new Map<RootHex, BlockInput<unknown>>();

  constructor(
    private config: ChainForkConfig,
    private custodyConfig: CustodyConfig,
    private logger?: Logger,
    private metrics?: Metrics
  ) {}

  getBlockInputByBlock(forkName: ForkName, block: SignedBeaconBlock): BlockInput {
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

  getBlockInputByBlob(forkName: ForkName, blobSidecar: deneb.BlobSidecar): BlockInput {
    const blockRoot = toHex(
      this.config
        .getForkTypes(blobSidecar.signedBlockHeader.message.slot)
        .BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message)
    );

    let blockInput = this.blockInputs.get(blockRoot) as BlockInputBlobs;
    if (blockInput) {
      if (blockInput.type !== BlockInputType.Blobs) {
        throw new SeenBlockInputCacheError(
          {
            code: SeenBlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE,
            cachedType: blockInput.type,
            requestedType: BlockInputType.Blobs,
          },
          `BlockInputType mismatch for slot=${blobSidecar.signedBlockHeader.message.slot} blockRoot=${blockRoot}`
        );
      }
      if (blockInput.hasBlob(blobSidecar)) {
        // TODO: not sure if this should throw here or maybe collect a metric. Saw a note about
        //       handling this case but this is newly added
      } else {
        blockInput.addBlob(this.config, blobSidecar);
      }
    } else {
      blockInput = BlockInputBlobs.createFromBlobSidecar(this.config, blobSidecar);
      this.blockInputs.set(blockRoot, blockInput);
    }

    return blockInput;
  }

  getBlockInputByColumn(forkName: ForkName, columnSidecar: fulu.DataColumnSidecar): BlockInput {
    const blockRoot = toHex(
      this.config
        .getForkTypes(columnSidecar.signedBlockHeader.message.slot)
        .BeaconBlockHeader.hashTreeRoot(columnSidecar.signedBlockHeader.message)
    );

    let blockInput = this.blockInputs.get(blockRoot) as BlockInputColumns;
    if (blockInput) {
      if (blockInput.type !== BlockInputType.Blobs) {
        throw new SeenBlockInputCacheError(
          {
            code: SeenBlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE,
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

enum SeenBlockInputCacheErrorCode {
  WRONG_BLOCK_INPUT_TYPE = "BLOCK_INPUT_CACHE_ERROR_WRONG_BLOCK_INPUT_TYPE",
}

type SeenBlockInputCacheErrorType = {
  code: SeenBlockInputCacheErrorCode.WRONG_BLOCK_INPUT_TYPE;
  cachedType: BlockInputType;
  requestedType: BlockInputType;
};

class SeenBlockInputCacheError extends LodestarError<SeenBlockInputCacheErrorType> {}
