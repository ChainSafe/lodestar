import {routes} from "@lodestar/api";
import {ApiError, ApplicationMethods} from "@lodestar/api/server";
import {
  ForkPostBellatrix,
  NUMBER_OF_COLUMNS,
  SLOTS_PER_HISTORICAL_ROOT,
  isForkPostBellatrix,
  isForkPostDeneb,
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
  sszTypesFor,
} from "@lodestar/types";
import {fromHex, sleep, toHex, toRootHex} from "@lodestar/utils";
import {
  BlobsSource,
  BlockInput,
  BlockInputAvailableData,
  BlockInputBlobs,
  BlockInputDataColumns,
  BlockInputType,
  BlockSource,
  DataColumnsSource,
  ImportBlockOpts,
  getBlockInput,
} from "../../../../chain/blocks/types.js";
import {verifyBlocksInEpoch} from "../../../../chain/blocks/verifyBlock.js";
import {BeaconChain} from "../../../../chain/chain.js";
import {BlockError, BlockErrorCode, BlockGossipError} from "../../../../chain/errors/index.js";
import {validateGossipBlock} from "../../../../chain/validation/block.js";
import {OpSource} from "../../../../chain/validatorMonitor.js";
import {NetworkEvent} from "../../../../network/index.js";
import {
  computeBlobSidecars,
  computeDataColumnSidecars,
  kzgCommitmentToVersionedHash,
  reconstructBlobs,
} from "../../../../util/blobs.js";
import {isOptimisticBlock} from "../../../../util/forkChoice.js";
import {promiseAllMaybeAsync} from "../../../../util/promises.js";
import {ApiModules} from "../../types.js";
import {assertUniqueItems} from "../../utils.js";
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
    let blockForImport: BlockInput,
      signedBlock: SignedBeaconBlock,
      blobSidecars: deneb.BlobSidecars,
      dataColumnSidecars: fulu.DataColumnSidecars;

    if (isSignedBlockContents(signedBlockOrContents)) {
      ({signedBlock} = signedBlockOrContents);
      const fork = config.getForkName(signedBlock.message.slot);
      let blockData: BlockInputAvailableData;
      if (isForkPostFulu(fork)) {
        const cachedContents = chain.getContents(signedBlock.message as deneb.BeaconBlock);

        const timer = metrics?.peerDas.dataColumnSidecarComputationTime.startTimer();
        dataColumnSidecars = computeDataColumnSidecars(config, signedBlock, cachedContents ?? signedBlockOrContents);
        timer?.();
        blockData = {
          fork,
          dataColumns: dataColumnSidecars,
          dataColumnsBytes: dataColumnSidecars.map(() => null),
          dataColumnsSource: DataColumnsSource.api,
        } as BlockInputDataColumns;
        blobSidecars = [];
      } else if (isForkPostDeneb(fork)) {
        blobSidecars = computeBlobSidecars(config, signedBlock, signedBlockOrContents);
        blockData = {
          fork,
          blobs: blobSidecars,
          blobsSource: BlobsSource.api,
        } as BlockInputBlobs;
        dataColumnSidecars = [];
      } else {
        throw Error(`Invalid data fork=${fork} for publish`);
      }

      blockForImport = getBlockInput.availableData(config, signedBlock, BlockSource.api, blockData);
    } else {
      signedBlock = signedBlockOrContents;
      blobSidecars = [];
      dataColumnSidecars = [];
      blockForImport = getBlockInput.preData(config, signedBlock, BlockSource.api);
    }

    // check what validations have been requested before broadcasting and publishing the block
    // TODO: add validation time to metrics
    broadcastValidation = broadcastValidation ?? routes.beacon.BroadcastValidation.gossip;
    // if block is locally produced, full or blinded, it already is 'consensus' validated as it went through
    // state transition to produce the stateRoot
    const slot = signedBlock.message.slot;
    const fork = config.getForkName(slot);
    const blockRoot = toRootHex(chain.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(signedBlock.message));
    // bodyRoot should be the same to produced block
    const bodyRoot = toRootHex(chain.config.getForkTypes(slot).BeaconBlockBody.hashTreeRoot(signedBlock.message.body));
    const blockLocallyProduced =
      chain.producedBlockRoot.has(blockRoot) || chain.producedBlindedBlockRoot.has(blockRoot);
    const valLogMeta = {slot, blockRoot, bodyRoot, broadcastValidation, blockLocallyProduced};

    switch (broadcastValidation) {
      case routes.beacon.BroadcastValidation.gossip: {
        if (!blockLocallyProduced) {
          try {
            await validateGossipBlock(config, chain, signedBlock, fork);
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
            network.events.emit(NetworkEvent.unknownBlockParent, {
              blockInput: blockForImport,
              peer: IDENTITY_PEER_ID,
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
            await verifyBlocksInEpoch.call(chain as BeaconChain, parentBlock, [blockForImport], {
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

      case routes.beacon.BroadcastValidation.none: {
        chain.logger.debug("Skipping broadcast validation", valLogMeta);
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
    const msToBlockSlot =
      computeTimeAtSlot(config, blockForImport.block.message.slot, chain.genesisTime) * 1000 - Date.now();
    if (msToBlockSlot <= MAX_API_CLOCK_DISPARITY_MS && msToBlockSlot > 0) {
      // If block is a bit early, hold it in a promise. Equivalent to a pending queue.
      await sleep(msToBlockSlot);
    }

    // TODO: Validate block
    const delaySec =
      seenTimestampSec - (chain.genesisTime + blockForImport.block.message.slot * config.SECONDS_PER_SLOT);
    metrics?.gossipBlock.elapsedTimeTillReceived.observe({source: OpSource.api}, delaySec);
    chain.validatorMonitor?.registerBeaconBlock(OpSource.api, delaySec, blockForImport.block.message);

    chain.logger.info("Publishing block", valLogMeta);
    const publishPromises = [
      // Send the block, regardless of whether or not it is valid. The API
      // specification is very clear that this is the desired behavior.
      //
      // - Publish blobs and block before importing so that network can see them asap
      // - Publish block first because
      //     a) as soon as node sees block they can start processing it while data is in transit
      //     b) getting block first allows nodes to use getBlobs from local ELs and save
      //        import latency and hopefully bandwidth
      //
      () => network.publishBeaconBlock(signedBlock),
      ...dataColumnSidecars.map((dataColumnSidecar) => () => network.publishDataColumnSidecar(dataColumnSidecar)),
      ...blobSidecars.map((blobSidecar) => () => network.publishBlobSidecar(blobSidecar)),
      () =>
        // there is no rush to persist block since we published it to gossip anyway
        chain
          .processBlock(blockForImport, {...opts, eagerPersistBlock: false})
          .catch((e) => {
            if (e instanceof BlockError && e.type.code === BlockErrorCode.PARENT_UNKNOWN) {
              network.events.emit(NetworkEvent.unknownBlockParent, {
                blockInput: blockForImport,
                peer: IDENTITY_PEER_ID,
              });
            }
            throw e;
          }),
    ];
    const sentPeersArr = await promiseAllMaybeAsync<number | void>(publishPromises);

    if (isForkPostFulu(fork)) {
      let columnsPublishedWithZeroPeers = 0;
      // sent peers per topic are logged in network.publishGossip(), here we only track metrics for it
      // starting from fulu, we have to push to 128 subnets so need to make sure we have enough sent peers per topic
      // + 1 because we publish to beacon_block first
      for (let i = 0; i < dataColumnSidecars.length; i++) {
        // + 1 because we publish to beacon_block first
        const sentPeers = sentPeersArr[i + 1] as number;
        // sent peers could be 0 as we set `allowPublishToZeroTopicPeers=true` in network.publishDataColumnSidecar() api
        metrics?.dataColumns.sentPeersPerSubnet.observe(sentPeers);
        if (sentPeers === 0) {
          columnsPublishedWithZeroPeers++;
        }
      }
      if (columnsPublishedWithZeroPeers > 0) {
        chain.logger.warn("Published data columns to 0 peers, increased risk of reorg", {
          slot,
          blockRoot,
          columns: columnsPublishedWithZeroPeers,
        });
      }
    }

    if (chain.emitter.listenerCount(routes.events.EventType.blockGossip)) {
      chain.emitter.emit(routes.events.EventType.blockGossip, {slot, block: blockRoot});
    }

    if (blockForImport.type === BlockInputType.availableData) {
      if (isForkPostFulu(blockForImport.blockData.fork)) {
        const {dataColumns} = blockForImport.blockData as BlockInputDataColumns;
        metrics?.dataColumns.bySource.inc({source: DataColumnsSource.api}, dataColumns.length);

        if (chain.emitter.listenerCount(routes.events.EventType.dataColumnSidecar)) {
          for (const dataColumnSidecar of dataColumns) {
            chain.emitter.emit(routes.events.EventType.dataColumnSidecar, {
              blockRoot,
              slot,
              index: dataColumnSidecar.index,
              kzgCommitments: dataColumnSidecar.kzgCommitments.map(toHex),
            });
          }
        }
      } else if (
        isForkPostDeneb(blockForImport.blockData.fork) &&
        chain.emitter.listenerCount(routes.events.EventType.blobSidecar)
      ) {
        const {blobs} = blockForImport.blockData as BlockInputBlobs;

        for (const blobSidecar of blobs) {
          const {index, kzgCommitment} = blobSidecar;
          chain.emitter.emit(routes.events.EventType.blobSidecar, {
            blockRoot,
            slot,
            index,
            kzgCommitment: toHex(kzgCommitment),
            versionedHash: toHex(kzgCommitmentToVersionedHash(kzgCommitment)),
          });
        }
      }
    }
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
    const fork = config.getForkName(slot);

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

    if (isForkPostFulu(fork)) {
      await submitBlindedBlockToBuilder(chain, {
        data: signedBlindedBlock,
        bytes: context?.sszBytes,
      });
      chain.logger.info("Submitted blinded block to builder for publishing", {slot, blockRoot});
    } else {
      // TODO: After fulu is live and all builders support submitBlindedBlockV2, we can safely remove
      // this code block and related functions
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
    }
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
      assertUniqueItems(indices, "Duplicate indices provided");

      const {block, executionOptimistic, finalized} = await getBlockResponse(chain, blockId);
      const fork = config.getForkName(block.message.slot);

      if (isForkPostFulu(fork)) {
        throw new ApiError(400, `Use getBlobs to retrieve blobs for post-fulu fork=${fork}`);
      }

      const blockRoot = sszTypesFor(fork).BeaconBlock.hashTreeRoot(block.message);

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

    async getBlobs({blockId, indices}) {
      assertUniqueItems(indices, "Duplicate indices provided");

      const {block, executionOptimistic, finalized} = await getBlockResponse(chain, blockId);
      const fork = config.getForkName(block.message.slot);
      const blockRoot = sszTypesFor(fork).BeaconBlock.hashTreeRoot(block.message);

      let blobs: deneb.Blobs;

      if (isForkPostFulu(fork)) {
        const {targetCustodyGroupCount} = chain.custodyConfig;
        if (targetCustodyGroupCount < NUMBER_OF_COLUMNS / 2) {
          throw Error(
            `Custody group count of ${targetCustodyGroupCount} is not sufficient to serve blobs, must custody at least ${NUMBER_OF_COLUMNS / 2} data columns`
          );
        }

        let {dataColumnSidecars} = (await db.dataColumnSidecars.get(blockRoot)) ?? {};
        if (!dataColumnSidecars) {
          ({dataColumnSidecars} = (await db.dataColumnSidecarsArchive.get(block.message.slot)) ?? {});
        }

        if (!dataColumnSidecars) {
          throw new ApiError(
            404,
            `dataColumnSidecars not found in db for slot=${block.message.slot} root=${toRootHex(blockRoot)}`
          );
        }

        blobs = await reconstructBlobs(dataColumnSidecars);
      } else if (isForkPostDeneb(fork)) {
        let {blobSidecars} = (await db.blobSidecars.get(blockRoot)) ?? {};
        if (!blobSidecars) {
          ({blobSidecars} = (await db.blobSidecarsArchive.get(block.message.slot)) ?? {});
        }

        if (!blobSidecars) {
          throw new ApiError(
            404,
            `blobSidecars not found in db for slot=${block.message.slot} root=${toRootHex(blockRoot)}`
          );
        }

        blobs = blobSidecars.sort((a, b) => a.index - b.index).map(({blob}) => blob);
      } else {
        blobs = [];
      }

      return {
        data: indices ? blobs.filter((_, i) => indices.includes(i)) : blobs,
        meta: {
          executionOptimistic,
          finalized,
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

async function submitBlindedBlockToBuilder(
  chain: ApiModules["chain"],
  signedBlindedBlock: WithOptionalBytes<SignedBlindedBeaconBlock>
): Promise<void> {
  const executionBuilder = chain.executionBuilder;
  if (!executionBuilder) {
    throw Error("executionBuilder required to submit SignedBlindedBeaconBlock to builder");
  }
  await executionBuilder.submitBlindedBlockNoResponse(signedBlindedBlock);
}
