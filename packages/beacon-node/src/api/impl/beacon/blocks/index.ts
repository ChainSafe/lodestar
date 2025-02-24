import {routes} from "@lodestar/api";
import {ApiError, ApplicationMethods} from "@lodestar/api/server";
import {
  ForkName,
  ForkPostBellatrix,
  NUMBER_OF_COLUMNS,
  SLOTS_PER_HISTORICAL_ROOT,
  isForkBlobs,
  isForkPostBellatrix,
  isForkPostElectra,
  isForkPostFulu,
} from "@lodestar/params";
import {
  computeEpochAtSlot,
  computeTimeAtSlot,
  reconstructFullBlockOrContents,
  signedBeaconBlockToBlinded,
} from "@lodestar/state-transition";
import {
  ProducedBlockSource,
  SignedBeaconBlock,
  SignedBeaconBlockOrContents,
  SignedBlindedBeaconBlock,
  WithOptionalBytes,
  deneb,
  fulu,
  isSignedBlockContents,
} from "@lodestar/types";
import {fromHex, sleep, toHex, toRootHex} from "@lodestar/utils";
import {
  BlobsSource,
  BlockInput,
  BlockInputAvailableData,
  BlockInputBlobs,
  BlockInputDataColumns,
  BlockSource,
  DataColumnsSource,
  ImportBlockOpts,
  getBlockInput,
} from "../../../../chain/blocks/types.js";
import {
  BlockInput as BlockInputNew,
  BlockInputBlobs as BlockInputBlobsNew,
  BlockInputColumns as BlockInputColumnsNew,
  BlockInputType,
  BlockInputSourceType,
  isBlockInputBlobs,
  isBlockInputColumns,
} from "../../../../chain/blocks/utils/blockInput.js";
import {verifyBlocksInEpoch} from "../../../../chain/blocks/verifyBlock.js";
import {BeaconChain} from "../../../../chain/chain.js";
import {BlockError, BlockErrorCode, BlockGossipError} from "../../../../chain/errors/index.js";
import {validateGossipBlock} from "../../../../chain/validation/block.js";
import {OpSource} from "../../../../metrics/validatorMonitor.js";
import {NetworkEvent} from "../../../../network/index.js";
import {computeBlobSidecars, computeDataColumnSidecars} from "../../../../util/blobs.js";
import {isOptimisticBlock} from "../../../../util/forkChoice.js";
import {promiseAllMaybeAsync} from "../../../../util/promises.js";
import {ApiModules} from "../../types.js";
import {getBlockResponse, toBeaconHeaderResponse} from "./utils.js";

type PublishBlockOpts = ImportBlockOpts;

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
}: Pick<
  ApiModules,
  "chain" | "config" | "metrics" | "network" | "db"
>): ApplicationMethods<routes.beacon.block.Endpoints> {
  const publishBlock: ApplicationMethods<routes.beacon.block.Endpoints>["publishBlockV2"] = async (
    {signedBlockOrContents, broadcastValidation},
    _context,
    opts: PublishBlockOpts = {}
  ) => {
    const seenTimestampSec = Date.now() / 1000;

    let blockInput: BlockInputNew;
    if (!isSignedBlockContents(signedBlockOrContents)) {
      const blockRoot = this.config
        .getForkTypes(signedBlockOrContents.message.slot)
        .SignedBeaconBlock.hashTreeRoot(signedBlockOrContents.message);
      blockInput = chain.blockInputCache.getBlockInputByBlock({blockRoot, block: signedBlockOrContents});
    } else {
      const blockRoot = this.config
        .getForkTypes(signedBlockOrContents.signedBlock.message.slot)
        .SignedBeaconBlock.hashTreeRoot(signedBlockOrContents.signedBlock.message);
      blockInput = chain.blockInputCache.getBlockInputByBlock({blockRoot, block: signedBlockOrContents.signedBlock});
      switch (blockInput.type) {
        case BlockInputType.PreDeneb:
          throw new Error("SignedBlockContents were sent to publishBlockV2 but BlockInput is PreDeneb");
        case BlockInputType.Blobs:
          // TODO (@matthewkeil) Look at this function signature to see if we can simplify the second param of
          //                     computeBlobSidecars to SignedBlockContents and get rid of the third
          for (const blobSidecar of computeBlobSidecars(
            config,
            signedBlockOrContents.signedBlock,
            signedBlockOrContents
          )) {
            (blockInput as BlockInputBlobsNew).addBlob(blobSidecar, BlockInputSourceType.api);
          }
          break;
        case BlockInputType.Columns:
          // TODO (@matthewkeil) Look at this function signature to see if we can simplify the second param of
          //                     computeDataColumnSidecars to SignedBlockContents and get rid of the third
          for (const columnSidecar of computeDataColumnSidecars(
            config,
            signedBlockOrContents.signedBlock,
            signedBlockOrContents
          )) {
            (blockInput as BlockInputColumnsNew).addColumnSidecar(columnSidecar, BlockInputSourceType.api);
          }
          break;
      }
    }

    const slot = blockInput.getSlot();
    const forkName = blockInput.getForkName();
    const signedBlock = blockInput.getBlock();
    const blockLocallyProduced =
      chain.producedBlockRoot.has(blockInput.rootHex) || chain.producedBlindedBlockRoot.has(blockInput.rootHex);
    // bodyRoot should be the same to produced block
    const bodyRoot = toRootHex(chain.config.getForkTypes(slot).BeaconBlockBody.hashTreeRoot(signedBlock.message.body));
    const valLogMeta = {slot, blockRoot: blockInput.rootHex, bodyRoot, broadcastValidation, blockLocallyProduced};
    switch (broadcastValidation) {
      case routes.beacon.BroadcastValidation.none: {
        chain.logger.debug("Skipping broadcast validation", valLogMeta);
        break;
      }

      case routes.beacon.BroadcastValidation.gossip: {
        if (!blockLocallyProduced) {
          try {
            await validateGossipBlock(config, chain, signedBlock, forkName);
          } catch (error) {
            if (error instanceof BlockGossipError && error.type.code === BlockErrorCode.ALREADY_KNOWN) {
              chain.logger.debug("Ignoring known block during publishing", valLogMeta);
              // Blocks might already be published by another node as part of a fallback setup or DVT cluster
              // and can reach our node by gossip before the api. The error can be ignored and should not result in a 500 response.
              return;
            }

            chain.logger.error("Gossip validations failed while publishing the block", valLogMeta, error as Error);
            chain.persistInvalidSszValue(
              chain.config.getForkTypes(slot).SignedBeaconBlock,
              signedBlock,
              "api_reject_gossip_failure"
            );
            throw error;
          }
        }
        chain.logger.debug("Gossip checks validated while publishing the block", valLogMeta);
        break;
      }

      case routes.beacon.BroadcastValidation.consensusAndEquivocation:
      case routes.beacon.BroadcastValidation.consensus: {
        // check if this beacon node produced the block else run validations
        if (!blockLocallyProduced) {
          const parentBlock = chain.forkChoice.getBlock(signedBlock.message.parentRoot);
          if (parentBlock === null) {
            // TODO (@matthewkeil) why do we try to sync the unknown parent?  How did the block get built and published
            //      to the API if its parent is unknown?  Seems like this is an invalid case or if its valid should
            //      the block be stored and published once its ancestry is known?
            network.events.emit(NetworkEvent.unknownParent, {
              blockInput: blockInput,
              source: BlockInputSourceType.api,
            });
            chain.persistInvalidSszValue(
              chain.config.getForkTypes(slot).SignedBeaconBlock,
              signedBlock,
              "api_reject_parent_unknown"
            );
            throw new BlockError(signedBlock, {
              code: BlockErrorCode.PARENT_UNKNOWN,
              parentRoot: toRootHex(signedBlock.message.parentRoot),
            });
          }

          try {
            await verifyBlocksInEpoch.call(chain as BeaconChain, parentBlock, [blockInput], {
              ...opts,
              verifyOnly: true,
              skipVerifyBlockSignatures: true,
              skipVerifyExecutionPayload: true,
              seenTimestampSec,
            });
          } catch (error) {
            chain.logger.error("Consensus checks failed while publishing the block", valLogMeta, error as Error);
            chain.persistInvalidSszValue(
              chain.config.getForkTypes(slot).SignedBeaconBlock,
              signedBlock,
              "api_reject_consensus_failure"
            );
            throw error;
          }
        }

        chain.logger.debug("Consensus validated while publishing block", valLogMeta);

        if (broadcastValidation === routes.beacon.BroadcastValidation.consensusAndEquivocation) {
          const message = `Equivocation checks not yet implemented for broadcastValidation=${broadcastValidation}`;
          if (chain.opts.broadcastValidationStrictness === "error") {
            throw Error(message);
          }
          chain.logger.warn(message, valLogMeta);
        }
        break;
      }

      default: {
        // error or log warning we do not support this validation
        const message = `Broadcast validation of ${broadcastValidation} type not implemented yet`;
        if (chain.opts.broadcastValidationStrictness === "error") {
          throw Error(message);
        }
        chain.logger.warn(message, valLogMeta);
      }
    }

    // Simple implementation of a pending block queue. Keeping the block here recycles the API logic, and keeps the
    // REST request promise without any extra infrastructure.
    const msToBlockSlot = computeTimeAtSlot(config, slot, chain.genesisTime) * 1000 - Date.now();
    if (msToBlockSlot <= MAX_API_CLOCK_DISPARITY_MS && msToBlockSlot > 0) {
      // If block is a bit early, hold it in a promise. Equivalent to a pending queue.
      await sleep(msToBlockSlot);
    }

    chain.emitter.emit(routes.events.EventType.blockGossip, {slot, block: blockInput.rootHex});

    // TODO: Validate block
    metrics?.registerBeaconBlock(OpSource.api, seenTimestampSec, signedBlock.message);
    chain.logger.info("Publishing block", valLogMeta);
    // Send the block, regardless of whether or not it is valid. The API
    // specification is very clear that this is the desired behavior.
    //
    // i) Publish blobs and block before importing so that network can see them asap
    // ii) publish blobs first because
    //     a) by the times nodes see block, they might decide to pull blobs
    //     b) they might require more hops to reach recipients in peerDAS kind of setup where
    //        blobs might need to hop between nodes because of partial subnet subscription
    const publishPromises: Array<() => Promise<unknown>> = [];
    if (isBlockInputBlobs(blockInput)) {
      publishPromises.push(...blockInput.getBlobs().map((blobSidecar) => network.publishBlobSidecar(blobSidecar)));
    } else if (isBlockInputColumns(blockInput)) {
      const dataColumnSidecars = blockInput.getAllColumns();
      // TODO (@matthewkeil) not sure if this check is necessary because they should have all been added above.... hmmm
      // if (dataColumnSidecars !== NUMBER_OF_COLUMNS) {
      //   chain.logger.warn(
      //     `Attempting to publish ${NUMBER_OF_COLUMNS} columns but ${NUMBER_OF_COLUMNS - dataColumnSidecars.length} are missing`
      //   );
      // }
      publishPromises.push(
        ...dataColumnSidecars.map((dataColumnSidecar) => () => network.publishDataColumnSidecar(dataColumnSidecar))
      );
    }
    publishPromises.push(
      () => network.publishBeaconBlock(signedBlock),
      () =>
        // there is no rush to persist block since we published it to gossip anyway
        chain
          .processBlock(blockInput, {...opts, eagerPersistBlock: false})
          .catch((e) => {
            if (e instanceof BlockError && e.type.code === BlockErrorCode.PARENT_UNKNOWN) {
              // TODO (@matthewkeil) why do we try to sync the unknown parent?  How did the block get built and published
              //      to the API if its parent is unknown?  Seems like this is an invalid case or if its valid should
              //      the block be stored and published once its ancestry is known?
              network.events.emit(NetworkEvent.unknownParent, {
                blockInput: blockInput,
                source: BlockInputSourceType.api,
              });
            }
            throw e;
          })
    );

    await promiseAllMaybeAsync(publishPromises);
  };

  const publishBlindedBlock: ApplicationMethods<routes.beacon.block.Endpoints>["publishBlindedBlock"] = async (
    {signedBlindedBlock},
    context,
    opts: PublishBlockOpts = {}
  ) => {
    const slot = signedBlindedBlock.message.slot;
    const blockRoot = toRootHex(
      chain.config
        .getPostBellatrixForkTypes(signedBlindedBlock.message.slot)
        .BlindedBeaconBlock.hashTreeRoot(signedBlindedBlock.message)
    );

    // Either the payload/blobs are cached from i) engine locally or ii) they are from the builder
    //
    // executionPayload can be null or a real payload in locally produced so check for presence of root
    const executionPayload = chain.producedBlockRoot.get(blockRoot);
    if (executionPayload !== undefined) {
      const source = ProducedBlockSource.engine;
      chain.logger.debug("Reconstructing  signedBlockOrContents", {slot, blockRoot, source});

      const contents = executionPayload
        ? (chain.producedContentsCache.get(toRootHex(executionPayload.blockHash)) ?? null)
        : null;
      const signedBlockOrContents = reconstructFullBlockOrContents(signedBlindedBlock, {executionPayload, contents});

      chain.logger.info("Publishing assembled block", {slot, blockRoot, source});
      return publishBlock({signedBlockOrContents}, {...context, sszBytes: null}, opts);
    }

    const source = ProducedBlockSource.builder;
    chain.logger.debug("Reconstructing  signedBlockOrContents", {slot, blockRoot, source});

    const signedBlockOrContents = await reconstructBuilderBlockOrContents(chain, {
      data: signedBlindedBlock,
      bytes: context?.sszBytes,
    });

    // the full block is published by relay and it's possible that the block is already known to us
    // by gossip
    //
    // see: https://github.com/ChainSafe/lodestar/issues/5404
    chain.logger.info("Publishing assembled block", {slot, blockRoot, source});
    return publishBlock({signedBlockOrContents}, {...context, sszBytes: null}, {...opts, ignoreIfKnown: true});
  };

  return {
    async getBlockHeaders({slot, parentRoot}) {
      // TODO - SLOW CODE: This code seems like it could be improved

      // If one block in the response contains an optimistic block, mark the entire response as optimistic
      let executionOptimistic = false;
      // If one block in the response is non finalized, mark the entire response as unfinalized
      let finalized = true;

      const result: routes.beacon.BlockHeaderResponse[] = [];
      if (parentRoot) {
        const finalizedBlock = await db.blockArchive.getByParentRoot(fromHex(parentRoot));
        if (finalizedBlock) {
          result.push(toBeaconHeaderResponse(config, finalizedBlock, true));
        }
        const nonFinalizedBlocks = chain.forkChoice.getBlockSummariesByParentRoot(parentRoot);
        await Promise.all(
          nonFinalizedBlocks.map(async (summary) => {
            const block = await db.block.get(fromHex(summary.blockRoot));
            if (block) {
              const canonical = chain.forkChoice.getCanonicalBlockAtSlot(block.message.slot);
              if (canonical) {
                result.push(toBeaconHeaderResponse(config, block, canonical.blockRoot === summary.blockRoot));
                if (isOptimisticBlock(canonical)) {
                  executionOptimistic = true;
                }
                // Block from hot db which only contains unfinalized blocks
                finalized = false;
              }
            }
          })
        );
        return {
          data: result.filter(
            (item) =>
              // skip if no slot filter
              !(slot !== undefined && slot !== 0) || item.header.message.slot === slot
          ),
          meta: {executionOptimistic, finalized},
        };
      }

      const headSlot = chain.forkChoice.getHead().slot;
      if (!parentRoot && slot === undefined) {
        slot = headSlot;
      }

      if (slot !== undefined) {
        // future slot
        if (slot > headSlot) {
          return {data: [], meta: {executionOptimistic: false, finalized: false}};
        }

        const canonicalBlock = await chain.getCanonicalBlockAtSlot(slot);
        // skip slot
        if (!canonicalBlock) {
          return {data: [], meta: {executionOptimistic: false, finalized: false}};
        }
        const canonicalRoot = config
          .getForkTypes(canonicalBlock.block.message.slot)
          .BeaconBlock.hashTreeRoot(canonicalBlock.block.message);
        result.push(toBeaconHeaderResponse(config, canonicalBlock.block, true));
        if (!canonicalBlock.finalized) {
          finalized = false;
        }

        // fork blocks
        // TODO: What is this logic?
        await Promise.all(
          chain.forkChoice.getBlockSummariesAtSlot(slot).map(async (summary) => {
            if (isOptimisticBlock(summary)) {
              executionOptimistic = true;
            }
            finalized = false;

            if (summary.blockRoot !== toRootHex(canonicalRoot)) {
              const block = await db.block.get(fromHex(summary.blockRoot));
              if (block) {
                result.push(toBeaconHeaderResponse(config, block));
              }
            }
          })
        );
      }

      return {
        data: result,
        meta: {executionOptimistic, finalized},
      };
    },

    async getBlockHeader({blockId}) {
      const {block, executionOptimistic, finalized} = await getBlockResponse(chain, blockId);
      return {
        data: toBeaconHeaderResponse(config, block, true),
        meta: {executionOptimistic, finalized},
      };
    },

    async getBlockV2({blockId}) {
      const {block, executionOptimistic, finalized} = await getBlockResponse(chain, blockId);
      return {
        data: block,
        meta: {
          executionOptimistic,
          finalized,
          version: config.getForkName(block.message.slot),
        },
      };
    },

    async getBlindedBlock({blockId}) {
      const {block, executionOptimistic, finalized} = await getBlockResponse(chain, blockId);
      const fork = config.getForkName(block.message.slot);
      return {
        data: isForkPostBellatrix(fork)
          ? signedBeaconBlockToBlinded(config, block as SignedBeaconBlock<ForkPostBellatrix>)
          : block,
        meta: {
          executionOptimistic,
          finalized,
          version: fork,
        },
      };
    },

    async getBlockAttestations({blockId}) {
      const {block, executionOptimistic, finalized} = await getBlockResponse(chain, blockId);
      const fork = config.getForkName(block.message.slot);

      if (isForkPostElectra(fork)) {
        throw new ApiError(
          400,
          `Use getBlockAttestationsV2 to retrieve block attestations for post-electra fork=${fork}`
        );
      }

      return {
        data: block.message.body.attestations,
        meta: {executionOptimistic, finalized},
      };
    },

    async getBlockAttestationsV2({blockId}) {
      const {block, executionOptimistic, finalized} = await getBlockResponse(chain, blockId);
      return {
        data: block.message.body.attestations,
        meta: {executionOptimistic, finalized, version: config.getForkName(block.message.slot)},
      };
    },

    async getBlockRoot({blockId}) {
      // Fast path: From head state already available in memory get historical blockRoot
      const slot = typeof blockId === "string" ? parseInt(blockId) : blockId;
      if (!Number.isNaN(slot)) {
        const head = chain.forkChoice.getHead();

        if (slot === head.slot) {
          return {
            data: {root: fromHex(head.blockRoot)},
            meta: {executionOptimistic: isOptimisticBlock(head), finalized: false},
          };
        }

        if (slot < head.slot && head.slot <= slot + SLOTS_PER_HISTORICAL_ROOT) {
          const state = chain.getHeadState();
          return {
            data: {root: state.blockRoots.get(slot % SLOTS_PER_HISTORICAL_ROOT)},
            meta: {
              executionOptimistic: isOptimisticBlock(head),
              finalized: computeEpochAtSlot(slot) <= chain.forkChoice.getFinalizedCheckpoint().epoch,
            },
          };
        }
      } else if (blockId === "head") {
        const head = chain.forkChoice.getHead();
        return {
          data: {root: fromHex(head.blockRoot)},
          meta: {executionOptimistic: isOptimisticBlock(head), finalized: false},
        };
      }

      // Slow path
      const {block, executionOptimistic, finalized} = await getBlockResponse(chain, blockId);
      return {
        data: {root: config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message)},
        meta: {executionOptimistic, finalized},
      };
    },

    publishBlock,
    publishBlindedBlock,

    async publishBlindedBlockV2(args, context, opts) {
      await publishBlindedBlock(args, context, opts);
    },

    async publishBlockV2(args, context, opts) {
      await publishBlock(args, context, opts);
    },

    async getBlobSidecars({blockId, indices}) {
      const {block, executionOptimistic, finalized} = await getBlockResponse(chain, blockId);
      const blockRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);

      let {blobSidecars} = (await db.blobSidecars.get(blockRoot)) ?? {};
      if (!blobSidecars) {
        ({blobSidecars} = (await db.blobSidecarsArchive.get(block.message.slot)) ?? {});
      }

      if (!blobSidecars) {
        throw Error(`blobSidecars not found in db for slot=${block.message.slot} root=${toRootHex(blockRoot)}`);
      }

      return {
        data: indices ? blobSidecars.filter(({index}) => indices.includes(index)) : blobSidecars,
        meta: {
          executionOptimistic,
          finalized,
          version: config.getForkName(block.message.slot),
        },
      };
    },
  };
}

async function reconstructBuilderBlockOrContents(
  chain: ApiModules["chain"],
  signedBlindedBlock: WithOptionalBytes<SignedBlindedBeaconBlock>
): Promise<SignedBeaconBlockOrContents> {
  const executionBuilder = chain.executionBuilder;
  if (!executionBuilder) {
    throw Error("executionBuilder required to publish SignedBlindedBeaconBlock");
  }

  const signedBlockOrContents = await executionBuilder.submitBlindedBlock(signedBlindedBlock);
  return signedBlockOrContents;
}
