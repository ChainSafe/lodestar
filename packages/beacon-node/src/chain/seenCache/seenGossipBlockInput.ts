import {toHexString} from "@chainsafe/ssz";
import {deneb, RootHex, SignedBeaconBlock, ssz, electra} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {pruneSetToMax} from "@lodestar/utils";
import {BLOBSIDECAR_FIXED_SIZE, isForkBlobs, ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";

import {
  BlockInput,
  NullBlockInput,
  getBlockInput,
  BlockSource,
  BlockInputDataBlobs,
  CachedData,
  GossipedInputType,
  getBlockInputBlobs,
  BlobsSource,
  DataColumnsSource,
  getBlockInputDataColumns,
  BlockInputDataDataColumns,
} from "../blocks/types.js";
import {Metrics} from "../../metrics/index.js";
import {CustodyConfig} from "../../util/dataColumns.js";

export enum BlockInputAvailabilitySource {
  GOSSIP = "gossip",
  UNKNOWN_SYNC = "unknown_sync",
}

type GossipedBlockInput =
  | {type: GossipedInputType.block; signedBlock: SignedBeaconBlock; blockBytes: Uint8Array | null}
  | {type: GossipedInputType.blob; blobSidecar: deneb.BlobSidecar; blobBytes: Uint8Array | null}
  | {
      type: GossipedInputType.dataColumn;
      dataColumnSidecar: electra.DataColumnSidecar;
      dataColumnBytes: Uint8Array | null;
    };

type BlockInputCacheType = {
  fork: ForkName;
  block?: SignedBeaconBlock;
  blockBytes?: Uint8Array | null;
  cachedData?: CachedData;
  // block promise and its callback cached for delayed resolution
  blockInputPromise: Promise<BlockInput>;
  resolveBlockInput: (blockInput: BlockInput) => void;
};

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
  private blockInputCache = new Map<RootHex, BlockInputCacheType>();
  constructor(private custodyConfig: CustodyConfig) {}

  prune(): void {
    pruneSetToMax(this.blockInputCache, MAX_GOSSIPINPUT_CACHE);
  }

  hasBlock(blockRoot: RootHex): boolean {
    return this.blockInputCache.has(blockRoot);
  }

  getGossipBlockInput(
    config: ChainForkConfig,
    gossipedInput: GossipedBlockInput,
    metrics: Metrics | null
  ):
    | {
        blockInput: BlockInput;
        blockInputMeta:
          | {pending: GossipedInputType.blob | null; haveBlobs: number; expectedBlobs: number}
          | {pending: GossipedInputType.dataColumn | null; haveColumns: number; expectedColumns: number};
      }
    | {
        blockInput: NullBlockInput;
        blockInputMeta: {pending: GossipedInputType.block} & (
          | {haveBlobs: number; expectedBlobs: null}
          | {haveColumns: number; expectedColumns: null}
        );
      } {
    let blockHex;
    let blockCache;
    let fork;

    if (gossipedInput.type === GossipedInputType.block) {
      const {signedBlock, blockBytes} = gossipedInput;
      fork = config.getForkName(signedBlock.message.slot);

      blockHex = toHexString(
        config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
      );
      blockCache = this.blockInputCache.get(blockHex) ?? getEmptyBlockInputCacheEntry(fork);

      blockCache.block = signedBlock;
      blockCache.blockBytes = blockBytes;
    } else if (gossipedInput.type === GossipedInputType.blob) {
      const {blobSidecar, blobBytes} = gossipedInput;
      const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
      fork = config.getForkName(blobSidecar.signedBlockHeader.message.slot);

      blockHex = toHexString(blockRoot);
      blockCache = this.blockInputCache.get(blockHex) ?? getEmptyBlockInputCacheEntry(fork);
      if (blockCache.cachedData?.fork !== ForkName.deneb) {
        throw Error(`blob data at non deneb fork=${blockCache.fork}`);
      }

      // TODO: freetheblobs check if its the same blob or a duplicate and throw/take actions
      blockCache.cachedData?.blobsCache.set(blobSidecar.index, {
        blobSidecar,
        // easily splice out the unsigned message as blob is a fixed length type
        blobBytes: blobBytes?.slice(0, BLOBSIDECAR_FIXED_SIZE) ?? null,
      });
    } else if (gossipedInput.type === GossipedInputType.dataColumn) {
      const {dataColumnSidecar, dataColumnBytes} = gossipedInput;
      const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(dataColumnSidecar.signedBlockHeader.message);
      fork = config.getForkName(dataColumnSidecar.signedBlockHeader.message.slot);

      blockHex = toHexString(blockRoot);
      blockCache = this.blockInputCache.get(blockHex) ?? getEmptyBlockInputCacheEntry(fork);
      if (blockCache.cachedData?.fork !== ForkName.electra) {
        throw Error(`blob data at non electra fork=${blockCache.fork}`);
      }

      // TODO: freetheblobs check if its the same blob or a duplicate and throw/take actions
      blockCache.cachedData?.dataColumnsCache.set(dataColumnSidecar.index, {
        dataColumnSidecar,
        // easily splice out the unsigned message as blob is a fixed length type
        dataColumnBytes: dataColumnBytes?.slice(0, dataColumnBytes.length) ?? null,
      });
    } else {
      // somehow helps resolve typescript that all types have been exausted
      throw Error("Invalid gossipedInput type");
    }

    if (!this.blockInputCache.has(blockHex)) {
      this.blockInputCache.set(blockHex, blockCache);
    }

    const {block: signedBlock, blockBytes, blockInputPromise, resolveBlockInput, cachedData} = blockCache;

    if (signedBlock !== undefined) {
      if (!isForkBlobs(fork)) {
        return {
          blockInput: getBlockInput.preData(config, signedBlock, BlockSource.gossip, blockBytes ?? null),
          blockInputMeta: {pending: null, haveBlobs: 0, expectedBlobs: 0},
        };
      }

      if (cachedData === undefined || !isForkBlobs(cachedData.fork)) {
        throw Error("Missing or Invalid fork cached Data for deneb+ block");
      }

      if (cachedData.fork === ForkName.deneb) {
        const {blobsCache} = cachedData;

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
          metrics?.syncUnknownBlock.resolveAvailabilitySource.inc({source: BlockInputAvailabilitySource.GOSSIP});
          const {blobs} = allBlobs;
          const blockData = {
            fork: cachedData.fork,
            ...allBlobs,
            blobsSource: BlobsSource.gossip,
          };
          const blockInput = getBlockInput.availableData(
            config,
            signedBlock,
            BlockSource.gossip,
            blockBytes ?? null,
            blockData
          );

          resolveBlockInput(blockInput);
          return {
            blockInput,
            blockInputMeta: {pending: null, haveBlobs: blobs.length, expectedBlobs: blobKzgCommitments.length},
          };
        } else {
          const blockInput = getBlockInput.dataPromise(
            config,
            signedBlock,
            BlockSource.gossip,
            blockBytes ?? null,
            cachedData
          );

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
      } else if (cachedData.fork === ForkName.electra) {
        const {dataColumnsCache} = cachedData;

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
          const blockData = {
            fork: cachedData.fork,
            dataColumns: [],
            dataColumnsBytes: [],
            dataColumnsLen: 0,
            dataColumnsIndex: new Uint8Array(NUMBER_OF_COLUMNS),
            dataColumnsSource: DataColumnsSource.gossip,
          };

          const blockInput = getBlockInput.availableData(
            config,
            signedBlock,
            BlockSource.gossip,
            blockBytes ?? null,
            blockData
          );

          resolveBlockInput(blockInput);
          return {
            blockInput,
            blockInputMeta: {pending: null, haveColumns: 0, expectedColumns: 0},
          };
        }

        const custodyIndexesPresent =
          dataColumnsCache.size >= this.custodyConfig.custodyColumnsLen &&
          this.custodyConfig.custodyColumns.reduce(
            (acc, columnIndex) => acc && dataColumnsCache.has(columnIndex),
            true
          );

        if (custodyIndexesPresent) {
          const allDataColumns = getBlockInputDataColumns(dataColumnsCache, this.custodyConfig.custodyColumns);
          metrics?.syncUnknownBlock.resolveAvailabilitySource.inc({source: BlockInputAvailabilitySource.GOSSIP});
          const {dataColumns} = allDataColumns;
          const blockData = {
            fork: cachedData.fork,
            ...allDataColumns,
            dataColumnsLen: this.custodyConfig.custodyColumnsLen,
            dataColumnsIndex: this.custodyConfig.custodyColumnsIndex,
            dataColumnsSource: DataColumnsSource.gossip,
          };
          const blockInput = getBlockInput.availableData(
            config,
            signedBlock,
            BlockSource.gossip,
            blockBytes ?? null,
            blockData
          );

          resolveBlockInput(blockInput);
          return {
            blockInput,
            blockInputMeta: {
              pending: null,
              haveColumns: dataColumns.length,
              expectedColumns: this.custodyConfig.custodyColumnsLen,
            },
          };
        } else {
          const blockInput = getBlockInput.dataPromise(
            config,
            signedBlock,
            BlockSource.gossip,
            blockBytes ?? null,
            cachedData
          );

          resolveBlockInput(blockInput);
          return {
            blockInput,
            blockInputMeta: {
              pending: GossipedInputType.dataColumn,
              haveColumns: dataColumnsCache.size,
              expectedColumns: this.custodyConfig.custodyColumnsLen,
            },
          };
        }
      } else {
        throw Error(`Invalid fork=${fork}`);
      }
    } else {
      // will need to wait for the block to showup
      if (cachedData === undefined) {
        throw Error("Missing cachedData for deneb+ blobs");
      }

      if (cachedData.fork === ForkName.deneb) {
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
      } else if (fork === ForkName.electra) {
        const {dataColumnsCache} = cachedData;

        return {
          blockInput: {
            block: null,
            blockRootHex: blockHex,
            cachedData,
            blockInputPromise,
          },
          blockInputMeta: {pending: GossipedInputType.block, haveColumns: dataColumnsCache.size, expectedColumns: null},
        };
      } else {
        throw Error(`invalid fork=${fork} data not implemented`);
      }
    }
  }
}

function getEmptyBlockInputCacheEntry(fork: ForkName): BlockInputCacheType {
  // Capture both the promise and its callbacks for blockInput and final availability
  // It is not spec'ed but in tests in Firefox and NodeJS the promise constructor is run immediately
  let resolveBlockInput: ((block: BlockInput) => void) | null = null;
  const blockInputPromise = new Promise<BlockInput>((resolveCB) => {
    resolveBlockInput = resolveCB;
  });
  if (resolveBlockInput === null) {
    throw Error("Promise Constructor was not executed immediately");
  }
  if (!isForkBlobs(fork)) {
    return {fork, blockInputPromise, resolveBlockInput};
  }

  if (fork === ForkName.deneb) {
    let resolveAvailability: ((blobs: BlockInputDataBlobs) => void) | null = null;
    const availabilityPromise = new Promise<BlockInputDataBlobs>((resolveCB) => {
      resolveAvailability = resolveCB;
    });

    if (resolveAvailability === null) {
      throw Error("Promise Constructor was not executed immediately");
    }

    const blobsCache = new Map();
    const cachedData: CachedData = {fork, blobsCache, availabilityPromise, resolveAvailability};
    return {fork, blockInputPromise, resolveBlockInput, cachedData};
  } else if (fork === ForkName.electra) {
    let resolveAvailability: ((blobs: BlockInputDataDataColumns) => void) | null = null;
    const availabilityPromise = new Promise<BlockInputDataDataColumns>((resolveCB) => {
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
    };
    return {fork, blockInputPromise, resolveBlockInput, cachedData};
  } else {
    throw Error(`Invalid fork=${fork} for getEmptyBlockInputCacheEntry`);
  }
}
