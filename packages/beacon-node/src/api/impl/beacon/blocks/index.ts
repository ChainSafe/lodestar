import {fromHexString, toHexString} from "@chainsafe/ssz";
import {routes, ServerApi, ResponseFormat} from "@lodestar/api";
import {computeTimeAtSlot, signedBlindedBlockToFull, signedBlindedBlobSidecarsToFull} from "@lodestar/state-transition";
import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {sleep, toHex, LogDataBasic} from "@lodestar/utils";
import {allForks, deneb, isSignedBlockContents, isSignedBlindedBlockContents} from "@lodestar/types";
import {BlockSource, getBlockInput, ImportBlockOpts, BlockInput} from "../../../../chain/blocks/types.js";
import {promiseAllMaybeAsync} from "../../../../util/promises.js";
import {isOptimisticBlock} from "../../../../util/forkChoice.js";
import {BlockError, BlockErrorCode} from "../../../../chain/errors/index.js";
import {OpSource} from "../../../../metrics/validatorMonitor.js";
import {NetworkEvent} from "../../../../network/index.js";
import {ApiModules} from "../../types.js";
import {resolveBlockId, toBeaconHeaderResponse} from "./utils.js";

type PublishBlockOpts = ImportBlockOpts & {broadcastValidation?: routes.beacon.BroadcastValidation};

type ParsedSignedBlindedBlockOrContents = {
  signedBlindedBlock: allForks.SignedBlindedBeaconBlock;
  signedBlindedBlobSidecars: deneb.SignedBlindedBlobSidecars | null;
};

/**
 * Validator clock may be advanced from beacon's clock. If the validator requests a resource in a
 * future slot, wait some time instead of rejecting the request because it's in the future
 */
const MAX_API_CLOCK_DISPARITY_MS = 1000;

/**
 * PeerID of identity keypair to signal self for score reporting
 */
const IDENTITY_PEER_ID = ""; // TODO: Compute identity keypair

export function getBeaconBlockApi({
  chain,
  config,
  metrics,
  network,
  db,
}: Pick<ApiModules, "chain" | "config" | "metrics" | "network" | "db">): ServerApi<routes.beacon.block.Api> {
  const publishBlock: ServerApi<routes.beacon.block.Api>["publishBlock"] = async (
    signedBlockOrContents,
    opts: PublishBlockOpts = {}
  ) => {
    const seenTimestampSec = Date.now() / 1000;
    let blockForImport: BlockInput, signedBlock: allForks.SignedBeaconBlock, signedBlobs: deneb.SignedBlobSidecars;

    if (isSignedBlockContents(signedBlockOrContents)) {
      ({signedBlock, signedBlobSidecars: signedBlobs} = signedBlockOrContents);
      blockForImport = getBlockInput.postDeneb(
        config,
        signedBlock,
        BlockSource.api,
        signedBlobs.map((sblob) => sblob.message),
        // don't bundle any bytes for block and blobs
        null,
        signedBlobs.map(() => null)
      );
    } else {
      signedBlock = signedBlockOrContents;
      signedBlobs = [];
      // TODO: Once API supports submitting data as SSZ, replace null with blockBytes
      blockForImport = getBlockInput.preDeneb(config, signedBlock, BlockSource.api, null);
    }

    // check what validations have been requested before broadcasting and publishing the block
    // TODO: add validation time to metrics
    const broadcastValidation = opts.broadcastValidation ?? routes.beacon.BroadcastValidation.none;
    // if block is locally produced, full or blinded, it already is 'consensus' validated as it went through
    // state transition to produce the stateRoot
    const slot = signedBlock.message.slot;
    const blockRoot = toHex(chain.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(signedBlock.message));
    const blockLocallyProduced =
      chain.producedBlockRoot.has(blockRoot) || chain.producedBlindedBlockRoot.has(blockRoot);
    const valLogMeta = {broadcastValidation, blockRoot, blockLocallyProduced, slot};

    switch (broadcastValidation) {
      case routes.beacon.BroadcastValidation.none: {
        if (blockLocallyProduced) {
          chain.logger.debug("No broadcast validation requested for the block", valLogMeta);
        } else {
          chain.logger.warn("No broadcast validation requested for the block", valLogMeta);
        }
        break;
      }
      case routes.beacon.BroadcastValidation.consensus: {
        // check if this beacon node produced the block else run validations
        if (!blockLocallyProduced) {
          // error or log warning that we support consensus val on blocks produced via this beacon node
          const message = "Consensus validation not implemented yet for block not produced by this beacon node";
          if (chain.opts.broadcastValidationStrictness === "error") {
            throw Error(message);
          } else {
            chain.logger.warn(message, valLogMeta);
          }
        }
        break;
      }

      default: {
        // error or log warning we do not support this validation
        const message = `Broadcast validation of ${broadcastValidation} type not implemented yet`;
        if (chain.opts.broadcastValidationStrictness === "error") {
          throw Error(message);
        } else {
          chain.logger.warn(message);
        }
      }
    }

    // Simple implementation of a pending block queue. Keeping the block here recycles the API logic, and keeps the
    // REST request promise without any extra infrastructure.
    const msToBlockSlot =
      computeTimeAtSlot(config, blockForImport.block.message.slot, chain.genesisTime) * 1000 - Date.now();
    if (msToBlockSlot <= MAX_API_CLOCK_DISPARITY_MS && msToBlockSlot > 0) {
      // If block is a bit early, hold it in a promise. Equivalent to a pending queue.
      await sleep(msToBlockSlot);
    }

    // TODO: Validate block
    metrics?.registerBeaconBlock(OpSource.api, seenTimestampSec, blockForImport.block.message);
    const publishPromises = [
      // Send the block, regardless of whether or not it is valid. The API
      // specification is very clear that this is the desired behaviour.
      () => network.publishBeaconBlock(signedBlock) as Promise<unknown>,
      () =>
        // there is no rush to persist block since we published it to gossip anyway
        chain.processBlock(blockForImport, {...opts, eagerPersistBlock: false}).catch((e) => {
          if (e instanceof BlockError && e.type.code === BlockErrorCode.PARENT_UNKNOWN) {
            network.events.emit(NetworkEvent.unknownBlockParent, {
              blockInput: blockForImport,
              peer: IDENTITY_PEER_ID,
            });
          }
          throw e;
        }),
      ...signedBlobs.map((signedBlob) => () => network.publishBlobSidecar(signedBlob)),
    ];
    await promiseAllMaybeAsync(publishPromises);
  };

  const publishBlindedBlock: ServerApi<routes.beacon.block.Api>["publishBlindedBlock"] = async (
    signedBlindedBlockOrContents,
    opts: PublishBlockOpts = {}
  ) => {
    const {signedBlindedBlock, signedBlindedBlobSidecars} =
      parseSignedBlindedBlockOrContents(signedBlindedBlockOrContents);

    const slot = signedBlindedBlock.message.slot;
    const blockRoot = toHex(
      chain.config
        .getBlindedForkTypes(signedBlindedBlock.message.slot)
        .BeaconBlock.hashTreeRoot(signedBlindedBlock.message)
    );
    const logCtx = {blockRoot, slot};

    // Either the payload/blobs are cached from i) engine locally or ii) they are from the builder
    //
    // executionPayload can be null or a real payload in locally produced, its only undefined when
    // the block came from the builder
    const executionPayload = chain.producedBlockRoot.get(blockRoot);
    const signedBlockOrContents =
      executionPayload !== undefined
        ? reconstructLocalBlockOrContents(
            chain,
            {signedBlindedBlock, signedBlindedBlobSidecars},
            executionPayload,
            logCtx
          )
        : await reconstructBuilderBlockOrContents(chain, signedBlindedBlockOrContents, logCtx);

    // the full block is published by relay and it's possible that the block is already known to us
    // by gossip
    //
    // see: https://github.com/ChainSafe/lodestar/issues/5404
    return publishBlock(signedBlockOrContents, {...opts, ignoreIfKnown: true});
  };

  return {
    async getBlockHeaders(filters) {
      // TODO - SLOW CODE: This code seems like it could be improved

      // If one block in the response contains an optimistic block, mark the entire response as optimistic
      let executionOptimistic = false;

      const result: routes.beacon.BlockHeaderResponse[] = [];
      if (filters.parentRoot) {
        const parentRoot = filters.parentRoot;
        const finalizedBlock = await db.blockArchive.getByParentRoot(fromHexString(parentRoot));
        if (finalizedBlock) {
          result.push(toBeaconHeaderResponse(config, finalizedBlock, true));
        }
        const nonFinalizedBlocks = chain.forkChoice.getBlockSummariesByParentRoot(parentRoot);
        await Promise.all(
          nonFinalizedBlocks.map(async (summary) => {
            const block = await db.block.get(fromHexString(summary.blockRoot));
            if (block) {
              const canonical = chain.forkChoice.getCanonicalBlockAtSlot(block.message.slot);
              if (canonical) {
                result.push(toBeaconHeaderResponse(config, block, canonical.blockRoot === summary.blockRoot));
                if (isOptimisticBlock(canonical)) {
                  executionOptimistic = true;
                }
              }
            }
          })
        );
        return {
          executionOptimistic,
          data: result.filter(
            (item) =>
              // skip if no slot filter
              !(filters.slot !== undefined && filters.slot !== 0) || item.header.message.slot === filters.slot
          ),
        };
      }

      const headSlot = chain.forkChoice.getHead().slot;
      if (!filters.parentRoot && filters.slot === undefined) {
        filters.slot = headSlot;
      }

      if (filters.slot !== undefined) {
        // future slot
        if (filters.slot > headSlot) {
          return {executionOptimistic: false, data: []};
        }

        const canonicalBlock = await chain.getCanonicalBlockAtSlot(filters.slot);
        // skip slot
        if (!canonicalBlock) {
          return {executionOptimistic: false, data: []};
        }
        const canonicalRoot = config
          .getForkTypes(canonicalBlock.block.message.slot)
          .BeaconBlock.hashTreeRoot(canonicalBlock.block.message);
        result.push(toBeaconHeaderResponse(config, canonicalBlock.block, true));

        // fork blocks
        // TODO: What is this logic?
        await Promise.all(
          chain.forkChoice.getBlockSummariesAtSlot(filters.slot).map(async (summary) => {
            if (isOptimisticBlock(summary)) {
              executionOptimistic = true;
            }

            if (summary.blockRoot !== toHexString(canonicalRoot)) {
              const block = await db.block.get(fromHexString(summary.blockRoot));
              if (block) {
                result.push(toBeaconHeaderResponse(config, block));
              }
            }
          })
        );
      }

      return {
        executionOptimistic,
        data: result,
      };
    },

    async getBlockHeader(blockId) {
      const {block, executionOptimistic} = await resolveBlockId(chain, blockId);
      return {
        executionOptimistic,
        data: toBeaconHeaderResponse(config, block, true),
      };
    },

    async getBlock(blockId, format?: ResponseFormat) {
      const {block} = await resolveBlockId(chain, blockId);
      if (format === "ssz") {
        return config.getForkTypes(block.message.slot).SignedBeaconBlock.serialize(block);
      }
      return {
        data: block,
      };
    },

    async getBlockV2(blockId, format?: ResponseFormat) {
      const {block, executionOptimistic} = await resolveBlockId(chain, blockId);
      if (format === "ssz") {
        return config.getForkTypes(block.message.slot).SignedBeaconBlock.serialize(block);
      }
      return {
        executionOptimistic,
        data: block,
        version: config.getForkName(block.message.slot),
      };
    },

    async getBlockAttestations(blockId) {
      const {block, executionOptimistic} = await resolveBlockId(chain, blockId);
      return {
        executionOptimistic,
        data: Array.from(block.message.body.attestations),
      };
    },

    async getBlockRoot(blockId) {
      // Fast path: From head state already available in memory get historical blockRoot
      const slot = typeof blockId === "string" ? parseInt(blockId) : blockId;
      if (!Number.isNaN(slot)) {
        const head = chain.forkChoice.getHead();

        if (slot === head.slot) {
          return {
            executionOptimistic: isOptimisticBlock(head),
            data: {root: fromHexString(head.blockRoot)},
          };
        }

        if (slot < head.slot && head.slot <= slot + SLOTS_PER_HISTORICAL_ROOT) {
          const state = chain.getHeadState();
          return {
            executionOptimistic: isOptimisticBlock(head),
            data: {root: state.blockRoots.get(slot % SLOTS_PER_HISTORICAL_ROOT)},
          };
        }
      } else if (blockId === "head") {
        const head = chain.forkChoice.getHead();
        return {
          executionOptimistic: isOptimisticBlock(head),
          data: {root: fromHexString(head.blockRoot)},
        };
      }

      // Slow path
      const {block, executionOptimistic} = await resolveBlockId(chain, blockId);
      return {
        executionOptimistic,
        data: {root: config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message)},
      };
    },

    publishBlock,
    publishBlindedBlock,

    async publishBlindedBlockV2(signedBlindedBlockOrContents, opts) {
      await publishBlindedBlock(signedBlindedBlockOrContents, opts);
    },

    async publishBlockV2(signedBlockOrContents, opts) {
      await publishBlock(signedBlockOrContents, opts);
    },

    async getBlobSidecars(blockId) {
      const {block, executionOptimistic} = await resolveBlockId(chain, blockId);
      const blockRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);

      let {blobSidecars} = (await db.blobSidecars.get(blockRoot)) ?? {};
      if (!blobSidecars) {
        ({blobSidecars} = (await db.blobSidecarsArchive.get(block.message.slot)) ?? {});
      }

      if (!blobSidecars) {
        throw Error(`blobSidecars not found in db for slot=${block.message.slot} root=${toHexString(blockRoot)}`);
      }
      return {
        executionOptimistic,
        data: blobSidecars,
      };
    },
  };
}

function parseSignedBlindedBlockOrContents(
  signedBlindedBlockOrContents: allForks.SignedBlindedBeaconBlockOrContents
): ParsedSignedBlindedBlockOrContents {
  if (isSignedBlindedBlockContents(signedBlindedBlockOrContents)) {
    const signedBlindedBlock = signedBlindedBlockOrContents.signedBlindedBlock;
    const signedBlindedBlobSidecars = signedBlindedBlockOrContents.signedBlindedBlobSidecars;
    return {signedBlindedBlock, signedBlindedBlobSidecars};
  } else {
    return {signedBlindedBlock: signedBlindedBlockOrContents, signedBlindedBlobSidecars: null};
  }
}

function reconstructLocalBlockOrContents(
  chain: ApiModules["chain"],
  {signedBlindedBlock, signedBlindedBlobSidecars}: ParsedSignedBlindedBlockOrContents,
  executionPayload: allForks.ExecutionPayload | null,
  logCtx: Record<string, LogDataBasic>
): allForks.SignedBeaconBlockOrContents {
  const signedBlock = signedBlindedBlockToFull(signedBlindedBlock, executionPayload);
  if (executionPayload !== null) {
    Object.assign(logCtx, {transactions: executionPayload.transactions.length});
  }

  if (signedBlindedBlobSidecars !== null) {
    if (executionPayload === null) {
      throw Error("Missing locally produced executionPayload for deneb+ publishBlindedBlock");
    }

    const blockHash = toHex(executionPayload.blockHash);
    const blobSidecars = chain.producedBlobSidecarsCache.get(blockHash);
    if (blobSidecars === undefined) {
      throw Error("Missing blobSidecars from the local execution cache");
    }
    if (blobSidecars.length !== signedBlindedBlobSidecars.length) {
      throw Error(
        `Length mismatch signedBlindedBlobSidecars=${signedBlindedBlobSidecars.length} blobSidecars=${blobSidecars.length}`
      );
    }
    const signedBlobSidecars = signedBlindedBlobSidecarsToFull(
      signedBlindedBlobSidecars,
      blobSidecars.map((blobSidecar) => blobSidecar.blob)
    );

    Object.assign(logCtx, {blobs: signedBlindedBlobSidecars.length});
    chain.logger.verbose("Block & blobs assembled from locally cached payload", logCtx);
    return {signedBlock, signedBlobSidecars} as allForks.SignedBeaconBlockOrContents;
  } else {
    chain.logger.verbose("Block assembled from locally cached payload", logCtx);
    return signedBlock as allForks.SignedBeaconBlockOrContents;
  }
}

async function reconstructBuilderBlockOrContents(
  chain: ApiModules["chain"],
  signedBlindedBlockOrContents: allForks.SignedBlindedBeaconBlockOrContents,
  logCtx: Record<string, LogDataBasic>
): Promise<allForks.SignedBeaconBlockOrContents> {
  // Mechanism for blobs & blocks on builder is implemenented separately in a followup deneb-builder PR
  if (isSignedBlindedBlockContents(signedBlindedBlockOrContents)) {
    throw Error("exeutionBuilder not yet implemented for deneb+ forks");
  }
  const executionBuilder = chain.executionBuilder;
  if (!executionBuilder) {
    throw Error("exeutionBuilder required to publish SignedBlindedBeaconBlock");
  }

  const signedBlockOrContents = await executionBuilder.submitBlindedBlock(signedBlindedBlockOrContents);
  chain.logger.verbose("Publishing block assembled from the builder", logCtx);
  return signedBlockOrContents;
}
