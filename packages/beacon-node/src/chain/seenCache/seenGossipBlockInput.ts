import {toHexString} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ForkName, NUMBER_OF_COLUMNS, isForkPostDeneb} from "@lodestar/params";
import {RootHex, SignedBeaconBlock, deneb, fulu, ssz} from "@lodestar/types";
import {Logger, pruneSetToMax} from "@lodestar/utils";

import {IExecutionEngine} from "../../execution/index.js";
import {Metrics} from "../../metrics/index.js";
import {CustodyConfig, getDataColumnsFromExecution, hasSampledDataColumns} from "../../util/dataColumns.js";
import {callInNextEventLoop} from "../../util/eventLoop.js";
import {
  BlobsSource,
  BlockInput,
  BlockInputBlobs,
  BlockInputDataColumns,
  BlockSource,
  CachedData,
  CachedDataColumns,
  DataColumnsSource,
  GossipedInputType,
  NullBlockInput,
  getBlockInput,
  getBlockInputBlobs,
  getBlockInputDataColumns,
} from "../blocks/types.js";
import {ChainEventEmitter} from "../emitter.js";
import {DataColumnSidecarErrorCode, DataColumnSidecarGossipError} from "../errors/dataColumnSidecarError.js";
import {GossipAction} from "../errors/gossipValidation.js";

export enum BlockInputAvailabilitySource {
  GOSSIP = "gossip",
  UNKNOWN_SYNC = "unknown_sync",
}

type GossipedBlockInput =
  | {type: GossipedInputType.block; signedBlock: SignedBeaconBlock}
  | {type: GossipedInputType.blob; blobSidecar: deneb.BlobSidecar}
  | {
      type: GossipedInputType.dataColumn;
      dataColumnSidecar: fulu.DataColumnSidecar;
      dataColumnBytes: Uint8Array | null;
    };

export type BlockInputCacheType = {
  fork: ForkName;
  block?: SignedBeaconBlock;
  cachedData?: CachedData;
  // block promise and its callback cached for delayed resolution
  blockInputPromise: Promise<BlockInput>;
  resolveBlockInput: (blockInput: BlockInput) => void;
};

type GossipBlockInputResponseWithBlock = {
  blockInput: BlockInput;
  blockInputMeta:
    | {pending: GossipedInputType.blob | null; haveBlobs: number; expectedBlobs: number}
    | {pending: GossipedInputType.dataColumn | null; haveColumns: number; expectedColumns: number};
};

type BlockInputPendingBlock = {pending: GossipedInputType.block};
export type BlockInputMetaPendingBlockWithBlobs = BlockInputPendingBlock & {haveBlobs: number; expectedBlobs: null};
type BlockInputMetaPendingBlockWithColumns = BlockInputPendingBlock & {haveColumns: number; expectedColumns: null};

type GossipBlockInputResponseWithNullBlock = {
  blockInput: NullBlockInput;
  blockInputMeta: BlockInputMetaPendingBlockWithBlobs | BlockInputMetaPendingBlockWithColumns;
};

type GossipBlockInputResponse = GossipBlockInputResponseWithBlock | GossipBlockInputResponseWithNullBlock;

const MAX_GOSSIPINPUT_CACHE = 5;

/**
 * For predeneb, SeenGossipBlockInput only tracks and caches block so that we don't need to download known block
 * roots. From deneb, it serves same purpose plus tracks and caches the live blobs and blocks on the network to
 * solve data availability for the blockInput. If no block has been seen yet for some already seen blobs, it
 * responds will null, but on the first block or the consequent blobs it responds with blobs promise till all blobs
 * become available.
 *
 * One can start processing block on blobs promise blockInput response and can await on the promise before
 * fully importing the block. The blobs promise is gets resolved as soon as all blobs corresponding to that
 * block are seen by SeenGossipBlockInput
 */
export class SeenGossipBlockInput {
  private readonly blockInputCache = new Map<RootHex, BlockInputCacheType>();
  private readonly custodyConfig: CustodyConfig;
  private readonly executionEngine: IExecutionEngine;
  private readonly emitter: ChainEventEmitter;
  private readonly logger: Logger;

  constructor(
    custodyConfig: CustodyConfig,
    executionEngine: IExecutionEngine,
    emitter: ChainEventEmitter,
    logger: Logger
  ) {
    this.custodyConfig = custodyConfig;
    this.executionEngine = executionEngine;
    this.emitter = emitter;
    this.logger = logger;
  }
  globalCacheId = 0;

  prune(): void {
    pruneSetToMax(this.blockInputCache, MAX_GOSSIPINPUT_CACHE);
  }

  hasBlock(blockRoot: RootHex): boolean {
    return this.blockInputCache.has(blockRoot);
  }

  /**
   * Intended to be used for gossip validation, specifically this check:
   * [IGNORE] The sidecar is the first sidecar for the tuple (block_header.slot, block_header.proposer_index,
   *          sidecar.index) with valid header signature, sidecar inclusion proof, and kzg proof
   */
  hasDataColumnSidecar(sidecar: fulu.DataColumnSidecar) {
    const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(sidecar.signedBlockHeader.message);
    const blockRootHex = toHexString(blockRoot);

    const blockCache = this.blockInputCache.get(blockRootHex);
    if (blockCache === undefined) {
      return false;
    }
    if (blockCache.cachedData === undefined || blockCache.cachedData.fork !== ForkName.fulu) {
      return false;
    }
    const existingSidecar = blockCache.cachedData.dataColumnsCache.get(sidecar.index);
    if (!existingSidecar) {
      return false;
    }
    return (
      sidecar.signedBlockHeader.message.slot === existingSidecar.dataColumn.signedBlockHeader.message.slot &&
      sidecar.index === existingSidecar.dataColumn.index &&
      sidecar.signedBlockHeader.message.proposerIndex ===
        existingSidecar.dataColumn.signedBlockHeader.message.proposerIndex
    );
  }

  getGossipBlockInput(
    config: ChainForkConfig,
    gossipedInput: GossipedBlockInput,
    metrics: Metrics | null
  ): GossipBlockInputResponse {
    let blockHex: RootHex;
    let blockCache: BlockInputCacheType;
    let fork: ForkName;

    if (gossipedInput.type === GossipedInputType.block) {
      const {signedBlock} = gossipedInput;
      fork = config.getForkName(signedBlock.message.slot);

      blockHex = toHexString(
        config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
      );
      blockCache = this.blockInputCache.get(blockHex) ?? getEmptyBlockInputCacheEntry(fork, ++this.globalCacheId);

      blockCache.block = signedBlock;
    } else if (gossipedInput.type === GossipedInputType.blob) {
      const {blobSidecar} = gossipedInput;
      const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
      fork = config.getForkName(blobSidecar.signedBlockHeader.message.slot);

      blockHex = toHexString(blockRoot);
      blockCache = this.blockInputCache.get(blockHex) ?? getEmptyBlockInputCacheEntry(fork, ++this.globalCacheId);
      if (blockCache.cachedData?.fork !== ForkName.deneb) {
        throw Error(`blob data at non deneb fork=${blockCache.fork}`);
      }

      // TODO: freetheblobs check if its the same blob or a duplicate and throw/take actions
      blockCache.cachedData?.blobsCache.set(blobSidecar.index, blobSidecar);
    } else if (gossipedInput.type === GossipedInputType.dataColumn) {
      const {dataColumnSidecar, dataColumnBytes} = gossipedInput;
      const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(dataColumnSidecar.signedBlockHeader.message);
      fork = config.getForkName(dataColumnSidecar.signedBlockHeader.message.slot);

      blockHex = toHexString(blockRoot);
      blockCache = this.blockInputCache.get(blockHex) ?? getEmptyBlockInputCacheEntry(fork, ++this.globalCacheId);
      if (blockCache.cachedData?.fork !== ForkName.fulu) {
        throw Error(`data column data at non fulu fork=${blockCache.fork}`);
      }

      if (this.hasDataColumnSidecar(dataColumnSidecar)) {
        throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
          code: DataColumnSidecarErrorCode.ALREADY_KNOWN,
          slot: dataColumnSidecar.signedBlockHeader.message.slot,
          columnIdx: dataColumnSidecar.index,
        });
      }

      blockCache.cachedData?.dataColumnsCache.set(dataColumnSidecar.index, {
        dataColumn: dataColumnSidecar,
        // easily splice out the unsigned message as blob is a fixed length type
        dataColumnBytes: dataColumnBytes?.slice(0, dataColumnBytes.length) ?? null,
      });
    } else {
      // somehow helps resolve typescript that all types have been exausted
      throw Error("Invalid gossipedInput type");
    }

    if (!this.blockInputCache.has(blockHex)) {
      this.blockInputCache.set(blockHex, blockCache);
      callInNextEventLoop(() => {
        getDataColumnsFromExecution(config, this.custodyConfig, this.executionEngine, this.emitter, blockCache, metrics)
          .then((_success) => {
            // TODO: (@matthewkeil) add metrics collection point here
          })
          .catch((error) => {
            this.logger.error("Error getting data columns from execution", {blockHex}, error);
          });
      });
    }

    const {block: signedBlock, blockInputPromise, resolveBlockInput, cachedData} = blockCache;

    if (signedBlock !== undefined) {
      if (!isForkPostDeneb(fork)) {
        return {
          blockInput: getBlockInput.preData(config, signedBlock, BlockSource.gossip),
          blockInputMeta: {pending: null, haveBlobs: 0, expectedBlobs: 0},
        };
      }

      if (cachedData === undefined || !isForkPostDeneb(cachedData.fork)) {
        throw Error("Missing or Invalid fork cached Data for post-deneb block");
      }

      if (cachedData.fork === ForkName.deneb || cachedData.fork === ForkName.electra) {
        const {blobsCache, resolveAvailability} = cachedData;

        // block is available, check if all blobs have shown up
        const {slot, body} = signedBlock.message;
        const {blobKzgCommitments} = body as deneb.BeaconBlockBody;
        const blockInfo = `blockHex=${blockHex}, slot=${slot}`;

        if (blobKzgCommitments.length < blobsCache.size) {
          throw Error(
            `Received more blobs=${blobsCache.size} than commitments=${blobKzgCommitments.length} for ${blockInfo}`
          );
        }

        if (blobKzgCommitments.length === blobsCache.size) {
          const allBlobs = getBlockInputBlobs(blobsCache);
          const {blobs} = allBlobs;
          const blockData = {
            fork: cachedData.fork,
            ...allBlobs,
            blobsSource: BlobsSource.gossip,
          };
          resolveAvailability(blockData);
          metrics?.syncUnknownBlock.resolveAvailabilitySource.inc({source: BlockInputAvailabilitySource.GOSSIP});

          const blockInput = getBlockInput.availableData(config, signedBlock, BlockSource.gossip, blockData);

          resolveBlockInput(blockInput);
          return {
            blockInput,
            blockInputMeta: {pending: null, haveBlobs: blobs.length, expectedBlobs: blobKzgCommitments.length},
          };
        }

        const blockInput = getBlockInput.dataPromise(config, signedBlock, BlockSource.gossip, cachedData);

        resolveBlockInput(blockInput);
        return {
          blockInput,
          blockInputMeta: {
            pending: GossipedInputType.blob,
            haveBlobs: blobsCache.size,
            expectedBlobs: blobKzgCommitments.length,
          },
        };
      }

      if (cachedData.fork === ForkName.fulu) {
        const {dataColumnsCache, resolveAvailability} = cachedData as CachedDataColumns;

        // block is available, check if all blobs have shown up
        const {slot} = signedBlock.message;
        const blockInfo = `blockHex=${blockHex}, slot=${slot}`;

        if (NUMBER_OF_COLUMNS < dataColumnsCache.size) {
          throw Error(
            `Received more dataColumns=${dataColumnsCache.size} than columns=${NUMBER_OF_COLUMNS} for ${blockInfo}`
          );
        }

        // get the custody columns and see if we have got all the requisite columns
        const blobKzgCommitmentsLen = (signedBlock.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;
        if (blobKzgCommitmentsLen === 0) {
          const blockData: BlockInputDataColumns = {
            fork: cachedData.fork,
            dataColumns: [],
            dataColumnsBytes: [],
            dataColumnsSource: DataColumnsSource.gossip,
          };
          resolveAvailability(blockData);
          metrics?.syncUnknownBlock.resolveAvailabilitySource.inc({source: BlockInputAvailabilitySource.GOSSIP});

          const blockInput = getBlockInput.availableData(config, signedBlock, BlockSource.gossip, blockData);

          resolveBlockInput(blockInput);
          return {
            blockInput,
            blockInputMeta: {pending: null, haveColumns: 0, expectedColumns: 0},
          };
        }

        if (hasSampledDataColumns(this.custodyConfig, dataColumnsCache)) {
          const allDataColumns = getBlockInputDataColumns(dataColumnsCache, this.custodyConfig.sampledColumns);
          metrics?.syncUnknownBlock.resolveAvailabilitySource.inc({source: BlockInputAvailabilitySource.GOSSIP});
          const {dataColumns} = allDataColumns;
          const blockData: BlockInputDataColumns = {
            fork: cachedData.fork,
            ...allDataColumns,
            dataColumnsSource: DataColumnsSource.gossip,
          };
          resolveAvailability(blockData);
          metrics?.syncUnknownBlock.resolveAvailabilitySource.inc({source: BlockInputAvailabilitySource.GOSSIP});

          const blockInput = getBlockInput.availableData(config, signedBlock, BlockSource.gossip, blockData);

          resolveBlockInput(blockInput);
          return {
            blockInput,
            blockInputMeta: {
              pending: null,
              haveColumns: dataColumns.length,
              expectedColumns: this.custodyConfig.sampledColumns.length,
            },
          };
        }

        const blockInput = getBlockInput.dataPromise(config, signedBlock, BlockSource.gossip, cachedData);

        resolveBlockInput(blockInput);
        return {
          blockInput,
          blockInputMeta: {
            pending: GossipedInputType.dataColumn,
            haveColumns: dataColumnsCache.size,
            expectedColumns: this.custodyConfig.sampledColumns.length,
          },
        };
      }

      throw Error(`Invalid fork=${fork}`);
    }

    // will need to wait for the block to showup
    if (cachedData === undefined) {
      throw Error("Missing cachedData for deneb+ blobs");
    }

    if (cachedData.fork === ForkName.deneb || cachedData.fork === ForkName.electra) {
      const {blobsCache} = cachedData;

      return {
        blockInput: {
          block: null,
          blockRootHex: blockHex,
          cachedData,
          blockInputPromise,
        },
        blockInputMeta: {pending: GossipedInputType.block, haveBlobs: blobsCache.size, expectedBlobs: null},
      };
    }

    if (fork === ForkName.fulu) {
      const {dataColumnsCache} = cachedData as CachedDataColumns;

      return {
        blockInput: {
          block: null,
          blockRootHex: blockHex,
          cachedData,
          blockInputPromise,
        },
        blockInputMeta: {pending: GossipedInputType.block, haveColumns: dataColumnsCache.size, expectedColumns: null},
      };
    }

    throw Error(`invalid fork=${fork} data not implemented`);

    /**
     * TODO: @matthewkeil this code was unreachable.  Commented to remove lint error but need to verify the condition
     * again to make sure this is not necessary before deleting it
     *
     * DO NOT DELETE until verified can be removed
     */
    // will need to wait for the block to showup
    // if (cachedData === undefined) {
    //   throw Error("Missing cachedData for deneb+ blobs");
    // }
    // const {blobsCache} = cachedData as CachedBlobs;

    // return {
    //   blockInput: {
    //     block: null,
    //     blockRootHex: blockHex,
    //     cachedData: cachedData as CachedData,
    //     blockInputPromise,
    //   },
    //   blockInputMeta: {pending: GossipedInputType.block, haveBlobs: blobsCache.size, expectedBlobs: null},
    // };
  }
}

export function getEmptyBlockInputCacheEntry(fork: ForkName, globalCacheId: number): BlockInputCacheType {
  // Capture both the promise and its callbacks for blockInput and final availability
  // It is not spec'ed but in tests in Firefox and NodeJS the promise constructor is run immediately
  let resolveBlockInput: ((block: BlockInput) => void) | null = null;
  const blockInputPromise = new Promise<BlockInput>((resolveCB) => {
    resolveBlockInput = resolveCB;
  });
  if (resolveBlockInput === null) {
    throw Error("Promise Constructor was not executed immediately");
  }
  if (!isForkPostDeneb(fork)) {
    return {fork, blockInputPromise, resolveBlockInput};
  }

  if (fork === ForkName.deneb || fork === ForkName.electra) {
    let resolveAvailability: ((blobs: BlockInputBlobs) => void) | null = null;
    const availabilityPromise = new Promise<BlockInputBlobs>((resolveCB) => {
      resolveAvailability = resolveCB;
    });

    if (resolveAvailability === null) {
      throw Error("Promise Constructor was not executed immediately");
    }

    const blobsCache = new Map();
    const cachedData: CachedData = {
      fork,
      blobsCache,
      availabilityPromise,
      resolveAvailability,
      cacheId: ++globalCacheId,
    };
    return {fork, blockInputPromise, resolveBlockInput, cachedData};
  }

  if (fork === ForkName.fulu) {
    let resolveAvailability: ((blobs: BlockInputDataColumns) => void) | null = null;
    const availabilityPromise = new Promise<BlockInputDataColumns>((resolveCB) => {
      resolveAvailability = resolveCB;
    });

    if (resolveAvailability === null) {
      throw Error("Promise Constructor was not executed immediately");
    }

    const dataColumnsCache = new Map();
    const cachedData: CachedData = {
      fork,
      dataColumnsCache,
      availabilityPromise,
      resolveAvailability,
      cacheId: ++globalCacheId,
    };
    return {fork, blockInputPromise, resolveBlockInput, cachedData};
  }

  throw Error(`Invalid fork=${fork} for getEmptyBlockInputCacheEntry`);
}
