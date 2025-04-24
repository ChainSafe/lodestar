import {ForkName, isForkPostDeneb} from "@lodestar/params";
import {RootHex, SignedBeaconBlock, deneb} from "@lodestar/types";
import {
  AddBlob,
  AddBlock,
  AddColumn,
  BlockInput,
  BlockInputBlobs,
  BlockInputColumns,
  BlockInputPreData,
  CustodyConfig,
  DARequirement,
  DAType,
  ForkBlobs,
  IBlockInput,
  SourceMeta,
  isForkPostFulu,
} from "./blockInput.js";
import {BlockInputError, BlockInputErrorCode} from "./errors.js";

// example block input cache

export class BlockInputCache {
  private cache: Map<RootHex, BlockInput> = new Map();
  private custodyConfig: CustodyConfig;

  constructor(custodyConfig: CustodyConfig) {
    this.custodyConfig = custodyConfig;
  }

  get(blockRootHex: RootHex): BlockInput | undefined {
    return this.cache.get(blockRootHex);
  }

  set(blockRootHex: RootHex, blockInput: BlockInput): void {
    this.cache.set(blockRootHex, blockInput);
  }

  delete(blockRootHex: RootHex): void {
    this.cache.delete(blockRootHex);
  }

  clear(): void {
    this.cache.clear();
  }

  createFromBlock(props: AddBlock & {daRequirement: DARequirement}): BlockInput {
    let blockInput = this.get(props.blockRootHex);
    if (blockInput) {
      (blockInput as IBlockInput).addBlock(props);
      return blockInput;
    }

    if (isForkPostFulu(props.forkName)) {
      blockInput = BlockInputColumns.createFromBlock({
        ...props,
        custodyConfig: this.custodyConfig,
      } as Parameters<typeof BlockInputColumns.createFromBlock>[0]);
    } else if (isForkPostDeneb(props.forkName)) {
      blockInput = BlockInputBlobs.createFromBlock(props as Parameters<typeof BlockInputBlobs.createFromBlock>[0]);
    } else {
      blockInput = BlockInputPreData.createFromBlock(props as Parameters<typeof BlockInputPreData.createFromBlock>[0]);
    }
    this.set(props.blockRootHex, blockInput);
    return blockInput;
  }

  createFromBlob(props: AddBlob): BlockInputBlobs {
    let blockInput = this.get(props.blockRootHex);
    if (blockInput) {
      if (blockInput.type !== DAType.Blobs) {
        throw new BlockInputError(
          {
            code: BlockInputErrorCode.DA_TYPE_MISMATCH,
            blockRoot: props.blockRootHex,
            expected: DAType.Blobs,
            actual: blockInput.type,
          },
          "Existing BlockInput does not match DA type"
        );
      }
      blockInput.addBlob(props);
      return blockInput;
    }

    blockInput = BlockInputBlobs.createFromBlob(props);
    this.set(props.blockRootHex, blockInput);
    return blockInput;
  }

  createFromColumn(props: AddColumn & {custodyConfig: CustodyConfig}): BlockInputColumns {
    let blockInput = this.get(props.blockRootHex);
    if (blockInput) {
      if (blockInput.type !== DAType.Columns) {
        throw new BlockInputError(
          {
            code: BlockInputErrorCode.DA_TYPE_MISMATCH,
            blockRoot: props.blockRootHex,
            expected: DAType.Columns,
            actual: blockInput.type,
          },
          "Existing BlockInput does not match DA type"
        );
      }
      blockInput.addColumn(props);
      return blockInput;
    }

    blockInput = BlockInputColumns.createFromColumn(props);
    this.set(props.blockRootHex, blockInput);
    return blockInput;
  }
}

// example usage of block input / cache

export function afterValidateBlock(
  forkName: ForkName,
  block: SignedBeaconBlock,
  cache: BlockInputCache,
  source: SourceMeta,
  blockRootHex: string
): void {
  // cache can handle calling the proper BlockInput constructor
  cache.createFromBlock({
    block,
    blockRootHex,
    forkName,
    daRequirement: DARequirement.Required,
    ...source,
  });
}

export function afterValidateBlob(
  forkName: ForkBlobs,
  blobSidecar: deneb.BlobSidecar,
  cache: BlockInputCache,
  source: SourceMeta,
  blockRootHex: string
): void {
  const blockInput = cache.get(blockRootHex);
  // block input type can be narrowed by checking its type against DAType (or using the isBlockInputXXX functions)
  if (blockInput?.type === DAType.Blobs) {
    blockInput.addBlob({
      blockRootHex,
      forkName,
      blobSidecar,
      ...source,
    });
  }

  // or the cache can handle calling the proper BlockInput constructor
  cache.createFromBlob({
    blockRootHex,
    blobSidecar,
    forkName,
    ...source,
  });
}
