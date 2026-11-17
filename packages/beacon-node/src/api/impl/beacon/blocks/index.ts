import {routes} from "@lodestar/api";
import {ApiError, ApplicationMethods} from "@lodestar/api/server";
import {PayloadStatus} from "@lodestar/fork-choice";
import {
  BUILDER_INDEX_SELF_BUILD,
  ForkPostBellatrix,
  ForkPostFulu,
  ForkPostGloas,
  ForkPreBellatrix,
  ForkPreGloas,
  NUMBER_OF_COLUMNS,
  SLOTS_PER_HISTORICAL_ROOT,
  isForkPostBellatrix,
  isForkPostDeneb,
  isForkPostFulu,
  isForkPostGloas,
} from "@lodestar/params";
import {
  computeEpochAtSlot,
  computeTimeAtSlot,
  isStatePostGloas,
  reconstructSignedBlockContents,
  signedBeaconBlockToBlinded,
  signedBlockToSignedHeader,
} from "@lodestar/state-transition";
import {
  ProducedBlockSource,
  RootHex,
  SignedBeaconBlock,
  SignedBlindedBeaconBlock,
  SignedBlockContents,
  WithOptionalBytes,
  deneb,
  fulu,
  gloas,
  isDenebBlockContents,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {byteArrayEquals, fromHex, prettyGweiToEth, sleep, toHex, toRootHex} from "@lodestar/utils";
import {BlockInputSource, isBlockInputColumns} from "../../../../chain/blocks/blockInput/index.js";
import {PayloadEnvelopeInputSource} from "../../../../chain/blocks/payloadEnvelopeInput/index.js";
import {ImportBlockOpts} from "../../../../chain/blocks/types.js";
import {verifyBlocksInEpoch} from "../../../../chain/blocks/verifyBlock.js";
import {verifyExecutionPayloadEnvelope} from "../../../../chain/blocks/verifyExecutionPayloadEnvelope.js";
import {BeaconChain} from "../../../../chain/chain.js";
import {ChainEvent} from "../../../../chain/emitter.js";
import {
  BlockError,
  BlockErrorCode,
  BlockGossipError,
  EnvelopeReconstructionError,
  EnvelopeReconstructionErrorCode,
  ExecutionPayloadEnvelopeError,
  ExecutionPayloadEnvelopeErrorCode,
} from "../../../../chain/errors/index.js";
import {
  BlockType,
  ProduceFullBellatrix,
  ProduceFullDeneb,
  ProduceFullFulu,
  ProduceFullGloas,
} from "../../../../chain/produceBlock/index.js";
import {RegenCaller} from "../../../../chain/regen/index.js";
import {validateGossipBlock, verifyBlockProposerSignature} from "../../../../chain/validation/block.js";
import {verifyDataColumnSidecarKzgProofs} from "../../../../chain/validation/dataColumnSidecar.js";
import {validateGossipExecutionPayloadBid} from "../../../../chain/validation/executionPayloadBid.js";
import {validateApiExecutionPayloadEnvelope} from "../../../../chain/validation/executionPayloadEnvelope.js";
import {OpSource} from "../../../../chain/validatorMonitor.js";
import {
  computePreFuluKzgCommitmentsInclusionProof,
  kzgCommitmentToVersionedHash,
  reconstructBlobs,
} from "../../../../util/blobs.js";
import {
  getBlobKzgCommitments,
  getDataColumnSidecarsFromBlock,
  getGloasDataColumnSidecars,
} from "../../../../util/dataColumns.js";
import {isOptimisticBlock} from "../../../../util/forkChoice.js";
import {kzg} from "../../../../util/kzg.js";
import {promiseAllMaybeAsync} from "../../../../util/promises.js";
import {ApiOptions} from "../../../options.js";
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

export function getBeaconBlockApi(
  opts: ApiOptions,
  {chain, config, metrics, network, db}: Pick<ApiModules, "chain" | "config" | "metrics" | "network" | "db">
): ApplicationMethods<routes.beacon.block.Endpoints> {
  const publishBlockV2: ApplicationMethods<routes.beacon.block.Endpoints>["publishBlockV2"] = async (
    {signedBlockContents, broadcastValidation, builderUrl},
    context,
    opts: PublishBlockOpts = {}
  ) => {
    const seenTimestampSec = Date.now() / 1000;
    const signedBlock = signedBlockContents.signedBlock;
    const slot = signedBlock.message.slot;
    const fork = config.getForkName(slot);
    if (!isForkPostFulu(fork)) {
      throw new ApiError(400, `Publishing blocks is not supported for pre-fulu fork=${fork}`);
    }
    const blockRoot = toRootHex(chain.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(signedBlock.message));

    const blockForImport = chain.seenBlockInputCache.getByBlock({
      block: signedBlock,
      source: BlockInputSource.api,
      seenTimestampSec,
      blockRootHex: blockRoot,
    });

    if (isForkPostGloas(fork)) {
      chain.seenPayloadEnvelopeInputCache.add({
        blockRootHex: blockRoot,
        block: signedBlock as SignedBeaconBlock<ForkPostGloas>,
        forkName: fork,
        sampledColumns: chain.custodyConfig.sampledColumns,
        custodyColumns: chain.custodyConfig.custodyColumns,
        seenTimestampSec,
        source: PayloadEnvelopeInputSource.api,
      });
    }

    // After gloas, data columns are not published with the block but when publishing the execution payload envelope.
    let dataColumnSidecars: fulu.DataColumnSidecar[] = [];

    if (isDenebBlockContents(signedBlockContents) && isForkPostFulu(fork) && !isForkPostGloas(fork)) {
      const timer = metrics?.peerDas.dataColumnSidecarComputationTime.startTimer();
      // If the block was produced by this node, we will already have computed cells
      // Otherwise, we will compute them from the blobs in this function
      const cells =
        (chain.blockProductionCache.get(blockRoot) as ProduceFullFulu)?.cells ??
        signedBlockContents.blobs.map((blob) => kzg.computeCells(blob));
      const cellsAndProofs = cells.map((rowCells, rowIndex) => ({
        cells: rowCells,
        proofs: signedBlockContents.kzgProofs.slice(rowIndex * NUMBER_OF_COLUMNS, (rowIndex + 1) * NUMBER_OF_COLUMNS),
      }));
      dataColumnSidecars = getDataColumnSidecarsFromBlock(
        config,
        signedBlock as SignedBeaconBlock<ForkPostFulu>,
        cellsAndProofs
      ) as fulu.DataColumnSidecar[];
      timer?.();
    }

    if (isBlockInputColumns(blockForImport)) {
      for (const dataColumnSidecar of dataColumnSidecars) {
        blockForImport.addColumn(
          {
            blockRootHex: blockRoot,
            columnSidecar: dataColumnSidecar,
            source: BlockInputSource.api,
            seenTimestampSec,
          },
          // In multi-BN setups (DVT, fallback), the same block may be published to multiple nodes.
          // Data columns may arrive via gossip from another node before the API publish completes,
          // so we allow duplicates here instead of throwing an error.
          {throwOnDuplicateAdd: false}
        );
      }
    }

    // check what validations have been requested before broadcasting and publishing the block
    // TODO: add validation time to metrics
    broadcastValidation = broadcastValidation ?? routes.beacon.BroadcastValidation.gossip;
    // if block is locally produced, full or blinded, it already is 'consensus' validated as it went through
    // state transition to produce the stateRoot
    // bodyRoot should be the same to produced block
    const bodyRoot = toRootHex(chain.config.getForkTypes(slot).BeaconBlockBody.hashTreeRoot(signedBlock.message.body));
    const blockLocallyProduced = chain.blockProductionCache.has(blockRoot);
    const valLogMeta = {slot, blockRoot, bodyRoot, broadcastValidation, blockLocallyProduced};
    // The payload of a self-built block is only revealed if the proposer signature of the block is valid
    let proposerSignatureValid: Promise<boolean> = Promise.resolve(true);

    if (chain.forkChoice.hasBlockHex(blockRoot)) {
      // Block was already imported, e.g. published again by the validator client or received via gossip
      chain.logger.debug("Ignoring already-known block during publishing", valLogMeta);
      return;
    }

    switch (broadcastValidation) {
      case routes.beacon.BroadcastValidation.gossip: {
        if (!blockLocallyProduced) {
          try {
            await validateGossipBlock(config, chain, signedBlock, fork);
          } catch (error) {
            if (error instanceof BlockGossipError) {
              switch (error.type.code) {
                case BlockErrorCode.ALREADY_KNOWN:
                  // Block has already been seen, e.g. via gossip racing the publish API. Benign.
                  chain.logger.debug("Ignoring already-known block during publishing", valLogMeta);
                  return;
              }
            }

            chain.logger.error("Gossip validations failed while publishing the block", valLogMeta, error as Error);
            chain.persistInvalidSszValue(
              chain.config.getForkTypes(slot).SignedBeaconBlock,
              signedBlock,
              "api_reject_gossip_failure",
              blockRoot
            );
            throw error;
          }
        } else if (isForkPostGloas(fork)) {
          // The gossip checks are skipped for a locally produced block, its proposer signature included. The
          // block is broadcast regardless, as before, but its payload must not be revealed if nobody validly
          // signed the block, as it can then never be imported. The check runs while the block is broadcast
          proposerSignatureValid = verifyBlockProposerSignature(chain, signedBlock, blockRoot).then(
            () => true,
            (e) => {
              chain.logger.error(
                "Proposer signature validation failed while publishing the block, not revealing its payload",
                valLogMeta,
                e as Error
              );
              return false;
            }
          );
        }
        chain.logger.debug("Gossip checks validated while publishing the block", valLogMeta);
        break;
      }

      case routes.beacon.BroadcastValidation.consensusAndEquivocation:
      case routes.beacon.BroadcastValidation.consensus: {
        // check if this beacon node produced the block else run validations
        if (!blockLocallyProduced) {
          const parentBlock = chain.forkChoice.getBlockDefaultStatus(signedBlock.message.parentRoot);
          if (parentBlock === null) {
            chain.emitter.emit(ChainEvent.blockUnknownParent, {
              blockInput: blockForImport,
              peer: IDENTITY_PEER_ID,
              source: BlockInputSource.api,
            });
            chain.persistInvalidSszValue(
              chain.config.getForkTypes(slot).SignedBeaconBlock,
              signedBlock,
              "api_reject_parent_unknown",
              blockRoot
            );
            throw new BlockError(signedBlock, {
              code: BlockErrorCode.PARENT_BLOCK_UNKNOWN,
              parentRoot: toRootHex(signedBlock.message.parentRoot),
            });
          }

          try {
            await verifyBlocksInEpoch.call(chain as BeaconChain, parentBlock, [blockForImport], null, {
              ...opts,
              verifyOnly: true,
              skipVerifyExecutionPayload: true,
              seenTimestampSec,
            });
          } catch (error) {
            chain.logger.error("Consensus checks failed while publishing the block", valLogMeta, error as Error);
            chain.persistInvalidSszValue(
              chain.config.getForkTypes(slot).SignedBeaconBlock,
              signedBlock,
              "api_reject_consensus_failure",
              blockRoot
            );
            throw error;
          }
        }

        chain.logger.debug("Consensus validated while publishing block", valLogMeta);

        // Non-local blocks had their proposer and block-body signatures checked by verifyBlocksInEpoch above
        // Locally produced blocks already passed block production validation, so only their proposer signature is unchecked
        // Verify that signature and observe the block root here
        if (blockLocallyProduced) {
          try {
            await verifyBlockProposerSignature(chain, signedBlock, blockRoot);
            chain.seenBlockProposers.observeBlockRoot(
              slot,
              signedBlock.message.proposerIndex,
              blockRoot,
              signedBlockToSignedHeader(config, signedBlock)
            );
          } catch (e) {
            chain.logger.error(
              "Proposer signature validation failed while publishing the block",
              valLogMeta,
              e as Error
            );
            chain.persistInvalidSszValue(
              chain.config.getForkTypes(slot).SignedBeaconBlock,
              signedBlock,
              "api_reject_consensus_failure",
              blockRoot
            );
            throw e;
          }
        }
        break;
      }

      default: {
        throw new ApiError(400, `Invalid broadcast validation level ${broadcastValidation}`);
      }
    }

    // Simple implementation of a pending block queue. Keeping the block here recycles the API logic, and keeps the
    // REST request promise without any extra infrastructure.
    const msToBlockSlot = computeTimeAtSlot(config, slot, chain.genesisTime) * 1000 - Date.now();
    if (msToBlockSlot <= MAX_API_CLOCK_DISPARITY_MS && msToBlockSlot > 0) {
      // If block is a bit early, hold it in a promise. Equivalent to a pending queue.
      await sleep(msToBlockSlot);
    }

    if (broadcastValidation === routes.beacon.BroadcastValidation.consensusAndEquivocation) {
      const conflictingRoots = chain.seenBlockProposers.getConflictingBlockRoots(
        slot,
        signedBlock.message.proposerIndex,
        blockRoot
      );
      if (conflictingRoots.length > 0) {
        chain.logger.warn("Not publishing block due to proposer equivocation", {
          ...valLogMeta,
          conflictingRoots: conflictingRoots.join(", "),
        });
        throw new ApiError(
          400,
          `Block is a proposer equivocation, conflicting block roots: ${conflictingRoots.join(", ")}`
        );
      }
      chain.logger.debug("Equivocation validated while publishing the block", valLogMeta);
    }

    // TODO: Validate block
    const delaySec = seenTimestampSec - computeTimeAtSlot(config, slot, chain.genesisTime);
    metrics?.gossipBlock.elapsedTimeTillReceived.observe({source: OpSource.api}, delaySec);
    chain.validatorMonitor?.registerBeaconBlock(OpSource.api, delaySec, signedBlock.message);

    chain.logger.info("Publishing block", valLogMeta);

    // Forward the signed block to the winning builder echoed by the validator client so it can
    // help disseminate the block and learn that its bid won without waiting for block gossip.
    // Failures are non-fatal, the builder also sees the block on gossip.
    if (isForkPostGloas(fork) && builderUrl !== undefined) {
      const gloasBlock = signedBlock as SignedBeaconBlock<ForkPostGloas>;
      if (gloasBlock.message.body.signedExecutionPayloadBid.message.builderIndex !== BUILDER_INDEX_SELF_BUILD) {
        chain.builderApiClient
          .submitSignedBeaconBlock(builderUrl, {data: gloasBlock, bytes: context?.sszBytes ?? undefined})
          .then(() => {
            chain.logger.debug("Submitted signed block to builder", {slot, builderUrl});
          })
          .catch((e) => {
            chain.logger.warn("Failed to submit signed block to builder", {...valLogMeta, builderUrl}, e);
          });
      }
    }

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
      async () => {
        const sentPeers = await network.publishBeaconBlock(signedBlock);
        // If this node built the block itself, it reveals the payload as soon as the block is broadcast
        if (await proposerSignatureValid) {
          chain.revealSelfBuiltPayload(blockRoot);
        }
        return sentPeers;
      },
      ...dataColumnSidecars.map((dataColumnSidecar) => () => network.publishDataColumnSidecar(dataColumnSidecar)),
      () =>
        // there is no rush to persist block since we published it to gossip anyway
        chain.processBlock(blockForImport, opts).catch((e) => {
          if (e instanceof BlockError) {
            switch (e.type.code) {
              case BlockErrorCode.ALREADY_KNOWN:
                // Block was imported while publishing, e.g. received via gossip
                chain.logger.debug("Ignoring already-known block during publishing", valLogMeta);
                return;
              case BlockErrorCode.PARENT_BLOCK_UNKNOWN:
              case BlockErrorCode.PARENT_PAYLOAD_UNKNOWN:
                chain.emitter.emit(ChainEvent.blockUnknownParent, {
                  blockInput: blockForImport,
                  peer: IDENTITY_PEER_ID,
                  source: BlockInputSource.api,
                });
            }
          }
          throw e;
        }),
    ];
    const sentPeersArr = await promiseAllMaybeAsync<{sentPeers: number; alreadyPublished: boolean} | number | void>(
      publishPromises
    );

    if (isForkPostGloas(fork)) {
      // After gloas, data columns are not published with the block but when publishing the execution payload envelope
    } else if (isForkPostFulu(fork)) {
      let columnsPublishedWithZeroPeers = 0;
      // sent peers per topic are logged in network.publishGossip(), here we only track metrics for it
      // starting from fulu, we have to push to 128 subnets so need to make sure we have enough sent peers per topic
      // + 1 because we publish to beacon_block first
      for (let i = 0; i < dataColumnSidecars.length; i++) {
        // + 1 because we publish to beacon_block first
        const {sentPeers, alreadyPublished} = sentPeersArr[i + 1] as {sentPeers: number; alreadyPublished: boolean};
        // sent peers could be 0, data_column_sidecar opts out of the zero peers publish error, see gossipTopicAllowPublishToZeroPeers
        metrics?.dataColumns.sentPeersPerSubnet.observe(sentPeers);
        // A duplicate publish (alreadyPublished=true) means the column is already propagating on the network —
        // expected in self-build flows where peers gossip columns back to us before we publish the envelope.
        // Only warn when we genuinely failed to reach any peer. See https://github.com/ChainSafe/lodestar/issues/9527.
        if (sentPeers === 0 && !alreadyPublished) {
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

    chain.emitter.emit(routes.events.EventType.blockGossip, {slot, block: blockRoot});

    if (isBlockInputColumns(blockForImport)) {
      const dataColumns = blockForImport.getAllColumns();
      metrics?.dataColumns.bySource.inc({source: BlockInputSource.api}, dataColumns.length);

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
    }
  };

  const publishBlindedBlockV2: ApplicationMethods<routes.beacon.block.Endpoints>["publishBlindedBlockV2"] = async (
    {signedBlindedBlock, broadcastValidation},
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

    if (isForkPostGloas(fork)) {
      throw new ApiError(400, `Blinded blocks are not available for post-gloas fork=${fork}`);
    }

    // Either the payload/blobs are cached from i) engine locally or ii) they are from the builder
    const producedResult = chain.blockProductionCache.get(blockRoot);
    if (producedResult !== undefined && producedResult.type !== BlockType.Blinded) {
      const source = ProducedBlockSource.engine;
      chain.logger.debug("Reconstructing the full signed block contents", {slot, blockRoot, source});

      const signedBlockContents = reconstructSignedBlockContents(
        fork,
        signedBlindedBlock,
        (producedResult as ProduceFullBellatrix).executionPayload ?? null,
        (producedResult as ProduceFullDeneb).blobsBundle ?? null
      );

      chain.logger.info("Publishing assembled block", {slot, blockRoot, source});
      return publishBlockV2({signedBlockContents, broadcastValidation}, {...context, sszBytes: null}, opts);
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
      chain.logger.debug("Reconstructing full signed block contents", {slot, blockRoot, source});

      const signedBlockContents = await reconstructBuilderSignedBlockContents(chain, {
        data: signedBlindedBlock,
        bytes: context?.sszBytes,
      });

      // the full block is published by relay and it's possible that the block is already known to us
      // by gossip
      //
      // see: https://github.com/ChainSafe/lodestar/issues/5404
      chain.logger.info("Publishing assembled block", {slot, blockRoot, source});
      return publishBlockV2(
        {signedBlockContents, broadcastValidation},
        {...context, sszBytes: null},
        {...opts, ignoreIfKnown: true}
      );
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
            const blockResult = await chain.getBlockByRoot(summary.blockRoot);
            if (blockResult) {
              const canonical = chain.forkChoice.getCanonicalBlockAtSlot(blockResult.block.message.slot);
              if (canonical) {
                result.push(
                  toBeaconHeaderResponse(config, blockResult.block, canonical.blockRoot === summary.blockRoot)
                );
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
              const blockResult = await chain.getBlockByRoot(summary.blockRoot);
              if (blockResult) {
                result.push(toBeaconHeaderResponse(config, blockResult.block));
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
      if (isForkPostGloas(fork)) {
        throw new ApiError(400, `Blinded blocks are not available for post-gloas fork=${fork}`);
      }
      return {
        data: isForkPostBellatrix(fork)
          ? signedBeaconBlockToBlinded(config, block as SignedBeaconBlock<ForkPostBellatrix & ForkPreGloas>)
          : (block as SignedBeaconBlock<ForkPreBellatrix>),
        meta: {
          executionOptimistic,
          finalized,
          version: fork,
        },
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
      // Fast path: From head state already available in memory get historical blockRoot.
      // A 0x id is a root. parseInt() accepts that prefix as hex and can return a slot.
      const slot =
        typeof blockId === "number"
          ? blockId
          : blockId.toLowerCase().startsWith("0x")
            ? Number.NaN
            : parseInt(blockId, 10);
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
            data: {root: state.getBlockRootAtSlot(slot)},
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

    publishBlockV2,
    publishBlindedBlockV2,

    async publishExecutionPayloadEnvelope({executionPayloadEnvelopeContents, broadcastValidation}) {
      const seenTimestampSec = Date.now() / 1000;

      // Blobs and KZG proofs are always submitted alongside the envelope
      const {executionPayloadEnvelope: envelope, ...submittedContents} = executionPayloadEnvelopeContents;
      const slot = envelope.payload.slotNumber;
      const fork = config.getForkName(slot);
      const blockRootHex = toRootHex(envelope.beaconBlockRoot);
      const blockHashHex = toRootHex(envelope.payload.blockHash);

      if (!isForkPostGloas(fork)) {
        throw new ApiError(400, `publishExecutionPayloadEnvelope not supported for pre-gloas fork=${fork}`);
      }

      let block = chain.forkChoice.getBlockHex(blockRootHex, PayloadStatus.EMPTY);
      if (block === null) {
        // Only wait if the envelope is for the current slot
        if (chain.clock.isCurrentSlotGivenGossipDisparity(slot)) {
          chain.logger.debug("Execution payload envelope received before block, waiting for block to be imported", {
            blockRoot: blockRootHex,
            slot,
          });
          await chain.waitForBlock(slot, blockRootHex);
          block = chain.forkChoice.getBlockHex(blockRootHex, PayloadStatus.EMPTY);
        }
        if (block === null) {
          throw new ApiError(404, `Block not found for beacon block root ${blockRootHex}`);
        }
      }
      if (block.slot !== slot) {
        throw new ApiError(400, `Envelope slot ${slot} does not match block slot ${block.slot}`);
      }

      // The envelope does not name its builder, the block's bid does
      const builderIndex = chain.seenPayloadEnvelopeInputCache.get(blockRootHex)?.getBuilderIndex();
      const isSelfBuild = builderIndex === BUILDER_INDEX_SELF_BUILD;
      const cachedResult = chain.blockProductionCache.get(blockRootHex);
      // Only use the cached result if it contains payload data, blocks committing to a bid are cached without it
      const cachedGloasResult =
        cachedResult !== undefined &&
        isForkPostGloas(cachedResult.fork) &&
        cachedResult.type === BlockType.Full &&
        (cachedResult as ProduceFullGloas).executionPayload !== undefined
          ? (cachedResult as ProduceFullGloas)
          : undefined;

      broadcastValidation = broadcastValidation ?? routes.beacon.BroadcastValidation.gossip;
      const valLogMeta = {
        slot,
        blockRoot: blockRootHex,
        blockHash: blockHashHex,
        builderIndex,
        isSelfBuild,
        broadcastValidation,
        submittedBlobs: submittedContents.blobs.length,
      };
      // An envelope this node already knows is not broadcast again, its blob data still is
      let envelopeAlreadyKnown = false;
      try {
        switch (broadcastValidation) {
          case routes.beacon.BroadcastValidation.gossip: {
            await validateApiExecutionPayloadEnvelope(chain, envelope);
            break;
          }

          case routes.beacon.BroadcastValidation.consensusAndEquivocation:
          case routes.beacon.BroadcastValidation.consensus: {
            await validateApiExecutionPayloadEnvelope(chain, envelope);

            // Verify the envelope against the post-block state
            const blockState = await chain.regen
              .getBlockSlotState(block, block.slot, {dontTransferCache: true}, RegenCaller.restApi)
              .catch((e) => {
                chain.logger.debug("Failed to regenerate block state for consensus checks", valLogMeta, e as Error);
                return null;
              });
            if (blockState === null || !isStatePostGloas(blockState)) {
              throw new ApiError(
                500,
                `Unable to regenerate block state for consensus checks slot=${slot} blockRoot=${blockRootHex}`
              );
            }
            try {
              // Payload root and executionRequestsRoot are already verified by gossip validation above
              verifyExecutionPayloadEnvelope(chain.config, blockState, envelope, {
                verifyExecutionRequestsRoot: false,
                verifyPayloadRoot: false,
              });
            } catch (error) {
              chain.logger.error(
                "Consensus checks failed while publishing execution payload envelope",
                valLogMeta,
                error as Error
              );
              throw new ApiError(400, (error as Error).message);
            }
            chain.logger.debug("Consensus validated while publishing execution payload envelope", valLogMeta);
            break;
          }

          default: {
            throw new ApiError(400, `Invalid broadcast validation level ${broadcastValidation}`);
          }
        }
      } catch (error) {
        if (
          error instanceof ExecutionPayloadEnvelopeError &&
          error.type.code === ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN
        ) {
          // The envelope may already be known, e.g. revealed by this node for a block it built itself or
          // received via gossip from another node in a multi node setup
          envelopeAlreadyKnown = true;
        } else {
          throw error;
        }
      }

      const payloadInput = chain.seenPayloadEnvelopeInputCache.get(blockRootHex);

      if (envelopeAlreadyKnown) {
        // Validation stops at the known envelope, before the submitted one is checked against the block. The bid
        // of the block commits to every field of the envelope, so if it matches the bid it is the known envelope
        const bid =
          payloadInput?.getBid() ??
          ((await chain.getBlockByRoot(blockRootHex))?.block as SignedBeaconBlock<ForkPostGloas> | undefined)?.message
            .body.signedExecutionPayloadBid.message;
        if (bid === undefined) {
          throw new ApiError(404, `Block not found for beacon block root ${blockRootHex}`);
        }
        try {
          assertEnvelopeMatchesBid(envelope, block.parentRoot, bid);
        } catch (error) {
          chain.logger.error(
            "Execution payload envelope does not match the known envelope of its block",
            valLogMeta,
            error as Error
          );
          throw error;
        }
        if (!payloadInput) {
          // The payload was imported and its PayloadEnvelopeInput pruned, the blob data was available then
          chain.logger.debug("Ignoring already-imported execution payload envelope during publishing", valLogMeta);
          return;
        }
        chain.logger.debug("Publishing data columns of already-known execution payload envelope", valLogMeta);
      }

      if (!payloadInput) {
        // The block is awaited above (queuing if the envelope arrived first), and both the API and
        // gossip import paths seed the PayloadEnvelopeInput before importing the block, so the input
        // should exist here.
        throw new ApiError(404, `PayloadEnvelopeInput not found for slot=${slot} blockRoot=${blockRootHex}`);
      }

      let dataColumnSidecars: gloas.DataColumnSidecar[] = [];
      let cells: fulu.Cell[][] | undefined;
      let kzgProofs: deneb.KZGProofs | undefined;
      let dataColumnTimer: (() => number) | undefined;

      // Validate submitted blob data against bid commitments before computing data column sidecars
      const expectedBlobCount = payloadInput.getVersionedHashes().length;
      if (submittedContents.blobs.length !== expectedBlobCount) {
        throw new ApiError(
          400,
          `Submitted blob count does not match bid commitments submitted=${submittedContents.blobs.length} expected=${expectedBlobCount}`
        );
      }
      const expectedProofCount = expectedBlobCount * NUMBER_OF_COLUMNS;
      if (submittedContents.kzgProofs.length !== expectedProofCount) {
        throw new ApiError(
          400,
          `Submitted KZG proof count does not match bid commitments submitted=${submittedContents.kzgProofs.length} expected=${expectedProofCount}`
        );
      }
      if (submittedContents.blobs.length > 0) {
        // If the block was produced by this node, reuse the cached cells and only time the
        // metric when cells are actually computed from the submitted blobs
        if (cachedGloasResult?.cells) {
          cells = cachedGloasResult.cells;
        } else {
          dataColumnTimer = metrics?.peerDas.dataColumnSidecarComputationTime.startTimer();
          cells = submittedContents.blobs.map((blob) => kzg.computeCells(blob));
        }
        kzgProofs = submittedContents.kzgProofs;
      }

      if (cells !== undefined && kzgProofs !== undefined && cells.length > 0) {
        const proofs = kzgProofs;
        // The request is not authenticated, anyone who holds the envelope can submit it. Its cells and proofs
        // must match the commitments of the bid before any data column built from them is stored or gossiped.
        // Proofs equal to those this node verified when it produced the block are not verified again
        const cachedProofs = cachedGloasResult?.cells ? cachedGloasResult.blobsBundle.proofs : undefined;
        const proofsLocallyProduced =
          cachedProofs !== undefined &&
          cachedProofs.length === proofs.length &&
          cachedProofs.every((cachedProof, i) => byteArrayEquals(cachedProof, proofs[i]));
        if (!proofsLocallyProduced) {
          const kzgCommitments = payloadInput.getBlobKzgCommitments();
          const cellCommitments: Uint8Array[] = [];
          const cellIndices: number[] = [];
          for (let rowIndex = 0; rowIndex < cells.length; rowIndex++) {
            for (let columnIndex = 0; columnIndex < NUMBER_OF_COLUMNS; columnIndex++) {
              cellCommitments.push(kzgCommitments[rowIndex]);
              cellIndices.push(columnIndex);
            }
          }
          const kzgProofTimer = metrics?.peerDas.dataColumnSidecarKzgProofsVerificationTime.startTimer();
          try {
            await verifyDataColumnSidecarKzgProofs(cellCommitments, cellIndices, cells.flat(), proofs);
          } catch (error) {
            chain.logger.error(
              "KZG proof validation failed while publishing execution payload envelope",
              valLogMeta,
              error as Error
            );
            throw new ApiError(
              400,
              `Submitted blobs and KZG proofs do not match bid commitments: ${(error as Error).message}`
            );
          } finally {
            kzgProofTimer?.();
          }
        }

        const cellsAndProofs = cells.map((rowCells, rowIndex) => ({
          cells: rowCells,
          proofs: proofs.slice(rowIndex * NUMBER_OF_COLUMNS, (rowIndex + 1) * NUMBER_OF_COLUMNS),
        }));

        dataColumnSidecars = getGloasDataColumnSidecars(slot, envelope.beaconBlockRoot, cellsAndProofs);
        dataColumnTimer?.();
      }

      // If called near a slot boundary (e.g. late in slot N-1), hold briefly so gossip aligns with slot N.
      const msToBlockSlot = computeTimeAtSlot(config, slot, chain.genesisTime) * 1000 - Date.now();
      if (msToBlockSlot <= MAX_API_CLOCK_DISPARITY_MS && msToBlockSlot > 0) {
        await sleep(msToBlockSlot);
      }

      // Keep this as the final async validation before publishing. A conflicting block may be observed while the
      // envelope, blob data, or slot timing is being validated above.
      if (broadcastValidation === routes.beacon.BroadcastValidation.consensusAndEquivocation) {
        const conflictingRoots = chain.seenBlockProposers.getConflictingBlockRoots(
          slot,
          payloadInput.proposerIndex,
          blockRootHex
        );
        if (conflictingRoots.length > 0) {
          chain.logger.warn("Not publishing execution payload envelope due to proposer equivocation", {
            ...valLogMeta,
            conflictingRoots: conflictingRoots.join(", "),
          });
          throw new ApiError(
            400,
            `Block of execution payload envelope is a proposer equivocation, conflicting block roots: ${conflictingRoots.join(", ")}`
          );
        }
        chain.logger.debug("Equivocation validated while publishing execution payload envelope", valLogMeta);
      }

      // This node built the block and reveals its payload itself, see `revealSelfBuiltPayload`. The submitted
      // envelope and blob data were validated above, against the bid if the node already holds the envelope.
      // Nothing of it is published here, else the envelope and the data columns the node is broadcasting or has
      // broadcast would go out twice. Wait for the reveal instead, which publishes what is still missing, emits
      // the `execution_payload_gossip` event once and imports the payload
      const revealCompletion = chain.completeSelfBuiltPayloadReveal(blockRootHex);
      if (revealCompletion != null) {
        const revealOutcome = await revealCompletion;
        if (!revealOutcome.envelopePublished || revealOutcome.unpublishedColumns > 0) {
          // The reveal logs why, and tries again by itself within the slot
          throw new ApiError(
            500,
            `Self-built execution payload not fully published slot=${slot} blockRoot=${blockRootHex} envelopePublished=${revealOutcome.envelopePublished} unpublishedColumns=${revealOutcome.unpublishedColumns} inFlight=${revealOutcome.inFlight}`
          );
        }
        chain.logger.debug("Execution payload envelope is revealed by this node, not publishing it again", valLogMeta);
        return;
      }

      if (envelopeAlreadyKnown) {
        // Only publish the data columns this node has not seen, the others were gossiped to or by this node
        dataColumnSidecars = dataColumnSidecars.filter(({index}) => !payloadInput.hasColumn(index));
      } else if (payloadInput.hasPayloadEnvelope()) {
        // The envelope may have been added while this request was being validated, e.g. via gossip
        chain.logger.debug("Execution payload envelope already added during publishing", valLogMeta);
      } else {
        payloadInput.addPayloadEnvelope({
          envelope,
          source: PayloadEnvelopeInputSource.api,
          seenTimestampSec,
          peerIdStr: undefined,
        });
      }

      if (dataColumnSidecars.length > 0) {
        for (const columnSidecar of dataColumnSidecars) {
          payloadInput.addColumn({
            columnSidecar,
            source: PayloadEnvelopeInputSource.api,
            seenTimestampSec,
            peerIdStr: undefined,
          });
        }
      }

      const delaySec = seenTimestampSec - computeTimeAtSlot(config, slot, chain.genesisTime);
      if (!envelopeAlreadyKnown) {
        metrics?.gossipExecutionPayloadEnvelope.elapsedTimeTillReceived.observe({source: OpSource.api}, delaySec);
        chain.validatorMonitor?.registerExecutionPayloadEnvelope(OpSource.api, delaySec, envelope);
      }

      chain.logger.info(
        envelopeAlreadyKnown
          ? "Publishing data columns of already-known execution payload envelope"
          : "Publishing execution payload envelope",
        {...valLogMeta, dataColumns: dataColumnSidecars.length}
      );

      const publishPromises = [
        // Gossip the execution payload envelope first, unless it is already known
        async () => (envelopeAlreadyKnown ? 0 : network.publishExecutionPayloadEnvelope(envelope)),
        // Publish all data column sidecars
        ...dataColumnSidecars.map((dataColumnSidecar) => () => network.publishDataColumnSidecar(dataColumnSidecar)),
        // Import execution payload
        async () => {
          // A known envelope may be imported already. If it is not, its import may have lacked the data columns
          // added above, an import that is still running is shared
          if (
            envelopeAlreadyKnown &&
            (!payloadInput.hasPayloadEnvelope() ||
              chain.forkChoice.getBlockHex(blockRootHex, PayloadStatus.FULL) !== null)
          ) {
            return;
          }
          return chain.processExecutionPayload(payloadInput, {
            // Only the submitted envelope is verified during broadcast validation,
            // an envelope cached by another source is verified at import
            validEnvelope: payloadInput.getPayloadEnvelope() === envelope,
          });
        },
      ];

      const publishPromise = promiseAllMaybeAsync<{sentPeers: number; alreadyPublished: boolean} | number | void>(
        publishPromises
      );

      if (!envelopeAlreadyKnown) {
        chain.emitter.emit(routes.events.EventType.executionPayloadGossip, {
          slot,
          builderIndex: payloadInput.getBuilderIndex(),
          blockHash: blockHashHex,
          payloadRoot: payloadInput.getPayloadRootHex(),
          blockRoot: blockRootHex,
        });
      }

      const sentPeersArr = await publishPromise;

      // Track metrics for data column publishing
      if (dataColumnSidecars.length > 0) {
        let columnsPublishedWithZeroPeers = 0;
        // Skip first entry (envelope); the final entry is processExecutionPayload(), which returns void.
        for (let i = 0; i < dataColumnSidecars.length; i++) {
          const {sentPeers, alreadyPublished} = sentPeersArr[i + 1] as {sentPeers: number; alreadyPublished: boolean};
          metrics?.dataColumns.sentPeersPerSubnet.observe(sentPeers);
          // A duplicate publish means the column is already propagating — expected in self-build flows.
          // Only warn when we genuinely failed to reach any peer. See https://github.com/ChainSafe/lodestar/issues/9527.
          if (sentPeers === 0 && !alreadyPublished) {
            columnsPublishedWithZeroPeers++;
          }
        }
        if (columnsPublishedWithZeroPeers > 0) {
          chain.logger.warn("Published data columns to 0 peers, increased risk of reorg", {
            slot,
            blockRoot: blockRootHex,
            columns: columnsPublishedWithZeroPeers,
          });
        }

        metrics?.dataColumns.bySource.inc({source: BlockInputSource.api}, dataColumnSidecars.length);

        if (chain.emitter.listenerCount(routes.events.EventType.dataColumnSidecar)) {
          for (const dataColumnSidecar of dataColumnSidecars) {
            chain.emitter.emit(routes.events.EventType.dataColumnSidecar, {
              blockRoot: blockRootHex,
              slot,
              index: dataColumnSidecar.index,
            });
          }
        }
      }

      chain.logger.info(
        envelopeAlreadyKnown
          ? "Published data columns of already-known execution payload envelope"
          : "Published execution payload envelope",
        {...valLogMeta, delaySec, sentPeers: (sentPeersArr[0] as number) ?? 0}
      );
    },

    async publishExecutionPayloadBid({signedExecutionPayloadBid}) {
      const seenTimestampSec = Date.now() / 1000;
      const bid = signedExecutionPayloadBid.message;
      const slot = bid.slot;
      const fork = config.getForkName(slot);

      if (!isForkPostGloas(fork)) {
        throw new ApiError(400, `publishExecutionPayloadBid not supported for pre-gloas fork=${fork}`);
      }

      const elapsedSec = chain.clock.secFromSlot(slot, seenTimestampSec);
      metrics?.gossipExecutionPayloadBid.elapsedTimeTillReceived.observe({source: OpSource.api}, elapsedSec);

      if (!opts.disableBidValidation) {
        const validationTimer = metrics?.opPool.executionPayloadBidPool.apiValidationTime.startTimer();
        const {proposerIndex} = await validateGossipExecutionPayloadBid(chain, signedExecutionPayloadBid);
        validationTimer?.();

        // Gossip does not deliver our own messages back to us, so a validated bid is added to the
        // pool here to allow a proposer on this node to select it
        const insertOutcome = chain.executionPayloadBidPool.add(
          signedExecutionPayloadBid,
          Math.floor(elapsedSec * 1000)
        );
        metrics?.opPool.executionPayloadBidPool.apiInsertOutcome.inc({insertOutcome});

        chain.validatorMonitor?.registerExecutionPayloadBid(OpSource.api, proposerIndex, bid);
      }

      const sentPeers = await network.publishSignedExecutionPayloadBid(signedExecutionPayloadBid);

      chain.emitter.emit(routes.events.EventType.executionPayloadBid, {
        version: fork,
        data: signedExecutionPayloadBid,
      });

      chain.logger.info("Published execution payload bid", {
        slot,
        builderIndex: bid.builderIndex,
        blockHash: toRootHex(bid.blockHash),
        parentBlockHash: toRootHex(bid.parentBlockHash),
        value: prettyGweiToEth(bid.value),
        sentPeers,
      });
    },

    async getExecutionPayloadEnvelope({blockId}, context) {
      const {block, finalized} = await getBlockResponse(chain, blockId);
      const slot = block.message.slot;
      const fork = config.getForkName(slot);

      if (!isForkPostGloas(fork)) {
        throw new ApiError(
          400,
          `Execution payload envelopes are not available for pre-gloas fork=${fork}, slot=${slot}`
        );
      }

      const blockRoot = config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message);
      const blockRootHex = toRootHex(blockRoot);

      // The block's own flag is the status of the payload it builds on, the envelope's is that of its
      // FULL variant. An unfinalized block without one has not imported its envelope yet.
      const payload = finalized ? null : chain.forkChoice.getBlockHex(blockRootHex, PayloadStatus.FULL);
      if (!finalized && payload === null) {
        throw new ApiError(404, `Execution payload envelope not found for slot=${slot}, blockRoot=${blockRootHex}`);
      }

      let data: Uint8Array | gloas.ExecutionPayloadEnvelope | null;
      try {
        data = context?.returnBytes
          ? await chain.getSerializedExecutionPayloadEnvelope(slot, blockRootHex)
          : await chain.getExecutionPayloadEnvelope(slot, blockRootHex);
      } catch (e) {
        if (e instanceof EnvelopeReconstructionError) {
          // The envelope is archived but our EL cannot serve it right now (EL down, or it does not
          // have the body / block access list): 503 so clients retry or ask another node, rather than
          // 500 for what is not a beacon node fault. A body root mismatch is a local inconsistency.
          const unavailable =
            e.type.code === EnvelopeReconstructionErrorCode.ENGINE_UNAVAILABLE ||
            e.type.code === EnvelopeReconstructionErrorCode.BODY_UNAVAILABLE;
          throw new ApiError(unavailable ? 503 : 500, `Failed to reconstruct execution payload envelope: ${e.message}`);
        }
        throw e;
      }

      if (!data) {
        throw new ApiError(404, `Execution payload envelope not found for slot=${slot}, blockRoot=${blockRootHex}`);
      }

      return {
        data,
        meta: {executionOptimistic: payload !== null && isOptimisticBlock(payload), finalized, version: fork},
      };
    },

    async getBlobSidecars({blockId, indices}) {
      assertUniqueItems(indices, "Duplicate indices provided");

      const {block, executionOptimistic, finalized} = await getBlockResponse(chain, blockId);
      const fork = config.getForkName(block.message.slot);
      const blockRoot = sszTypesFor(fork).BeaconBlock.hashTreeRoot(block.message);
      const blockRootHex = toRootHex(blockRoot);

      let data: deneb.BlobSidecars;

      if (isForkPostFulu(fork)) {
        const {targetCustodyGroupCount} = chain.custodyConfig;
        if (targetCustodyGroupCount < NUMBER_OF_COLUMNS / 2) {
          throw new ApiError(
            503,
            `Custody group count of ${targetCustodyGroupCount} is not sufficient to serve blob sidecars, must custody at least ${NUMBER_OF_COLUMNS / 2} data columns`
          );
        }

        const blobKzgCommitments = (block.message.body as deneb.BeaconBlockBody).blobKzgCommitments;
        const blobCount = blobKzgCommitments.length;

        if (blobCount > 0) {
          const dataColumnSidecars = await chain.getDataColumnSidecars(block.message.slot, blockRootHex);

          if (dataColumnSidecars.length === 0) {
            throw new ApiError(
              404,
              `dataColumnSidecars not found in db for slot=${block.message.slot} root=${toRootHex(blockRoot)} blobs=${blobCount}`
            );
          }

          for (const index of indices ?? []) {
            if (index < 0 || index >= blobCount) {
              throw new ApiError(400, `Invalid blob index ${index}, must be between 0 and ${blobCount - 1}`);
            }
          }

          const indicesToReconstruct = indices ?? Array.from({length: blobCount}, (_, i) => i);

          const timer = metrics?.recoverBlobSidecars.reconstructionTime.startTimer();
          const blobs = await reconstructBlobs(dataColumnSidecars, indicesToReconstruct);
          timer?.();
          metrics?.recoverBlobSidecars.blobsReconstructed.inc(indicesToReconstruct.length);

          const signedBlockHeader = signedBlockToSignedHeader(config, block);

          data = await Promise.all(
            indicesToReconstruct.map(async (index, i) => {
              // record per column computation time
              const compTimer = metrics?.peerDas.dataColumnSidecarComputationTime.startTimer();
              // Reconstruct blob sidecar from blob
              const kzgCommitment = blobKzgCommitments[index];
              const blob = blobs[i]; // Use i since blobs only contains requested indices
              const kzgProof = await kzg.asyncComputeBlobKzgProof(blob, kzgCommitment);
              const kzgCommitmentInclusionProof = computePreFuluKzgCommitmentsInclusionProof(
                fork,
                block.message.body,
                index
              );
              compTimer?.();
              return {index, blob, kzgCommitment, kzgProof, signedBlockHeader, kzgCommitmentInclusionProof};
            })
          );
        } else {
          data = [];
        }
      } else if (isForkPostDeneb(fork)) {
        const blobSidecars = await chain.getBlobSidecars(block.message.slot, blockRootHex);

        if (!blobSidecars) {
          throw new ApiError(
            404,
            `blobSidecars not found in db for slot=${block.message.slot} root=${toRootHex(blockRoot)}`
          );
        }

        data = indices ? blobSidecars.filter(({index}) => indices.includes(index)) : blobSidecars;
      } else {
        data = [];
      }

      return {
        data,
        meta: {
          executionOptimistic,
          finalized,
          version: config.getForkName(block.message.slot),
        },
      };
    },

    async getBlobs({blockId, versionedHashes}) {
      assertUniqueItems(versionedHashes, "Duplicate versioned hashes provided");

      const {block, executionOptimistic, finalized} = await getBlockResponse(chain, blockId);
      const fork = config.getForkName(block.message.slot);
      const blockRoot = sszTypesFor(fork).BeaconBlock.hashTreeRoot(block.message);
      const blockRootHex = toRootHex(blockRoot);

      let blobs: deneb.Blobs;

      if (isForkPostFulu(fork)) {
        const {targetCustodyGroupCount} = chain.custodyConfig;
        if (targetCustodyGroupCount < NUMBER_OF_COLUMNS / 2) {
          throw new ApiError(
            503,
            `Custody group count of ${targetCustodyGroupCount} is not sufficient to serve blobs, must custody at least ${NUMBER_OF_COLUMNS / 2} data columns`
          );
        }

        const blobKzgCommitments = getBlobKzgCommitments(fork, block as SignedBeaconBlock<ForkPostFulu>);
        const blobCount = blobKzgCommitments.length;

        if (blobCount > 0) {
          const dataColumnSidecars = await chain.getDataColumnSidecars(block.message.slot, blockRootHex);

          if (dataColumnSidecars.length === 0) {
            throw new ApiError(
              404,
              `dataColumnSidecars not found in db for slot=${block.message.slot} root=${toRootHex(blockRoot)} blobs=${blobCount}`
            );
          }

          let indicesToReconstruct: number[];
          if (versionedHashes) {
            const blockVersionedHashes = blobKzgCommitments.map((commitment) =>
              toHex(kzgCommitmentToVersionedHash(commitment))
            );
            indicesToReconstruct = [];
            for (const requestedHash of versionedHashes) {
              const index = blockVersionedHashes.findIndex((hash) => hash === requestedHash);
              if (index === -1) {
                throw new ApiError(400, `Versioned hash ${requestedHash} not found in block`);
              }
              indicesToReconstruct.push(index);
            }
            indicesToReconstruct.sort((a, b) => a - b);
          } else {
            indicesToReconstruct = Array.from({length: blobCount}, (_, i) => i);
          }

          const timer = metrics?.peerDas.dataColumnsReconstructionTime.startTimer();
          blobs = await reconstructBlobs(dataColumnSidecars, indicesToReconstruct);
          timer?.();
          metrics?.peerDas.reconstructedColumns.inc(indicesToReconstruct.length);
        } else {
          blobs = [];
        }
      } else if (isForkPostDeneb(fork)) {
        const blobSidecars = await chain.getBlobSidecars(block.message.slot, blockRootHex);

        if (!blobSidecars) {
          throw new ApiError(
            404,
            `blobSidecars not found in db for slot=${block.message.slot} root=${toRootHex(blockRoot)}`
          );
        }

        blobs = blobSidecars.sort((a, b) => a.index - b.index).map(({blob}) => blob);

        if (blobs.length && versionedHashes) {
          const kzgCommitments = (block as deneb.SignedBeaconBlock).message.body.blobKzgCommitments;

          const blockVersionedHashes = kzgCommitments.map((commitment) =>
            toHex(kzgCommitmentToVersionedHash(commitment))
          );

          const requestedIndices: number[] = [];
          for (const requestedHash of versionedHashes) {
            const index = blockVersionedHashes.findIndex((hash) => hash === requestedHash);
            if (index === -1) {
              throw new ApiError(400, `Versioned hash ${requestedHash} not found in block`);
            }
            requestedIndices.push(index);
          }

          blobs = requestedIndices.sort((a, b) => a - b).map((index) => blobs[index]);
        }
      } else {
        blobs = [];
      }

      return {
        data: blobs,
        meta: {
          executionOptimistic,
          finalized,
        },
      };
    },
  };
}

/**
 * Check every field of an envelope against its block. The bid of the block commits to all of them, so an
 * envelope that passes is the only valid envelope of the block.
 */
function assertEnvelopeMatchesBid(
  envelope: gloas.ExecutionPayloadEnvelope,
  blockParentRootHex: RootHex,
  bid: gloas.ExecutionPayloadBid
): void {
  if (toRootHex(envelope.parentBeaconBlockRoot) !== blockParentRootHex) {
    throw new ApiError(400, "Envelope parent beacon block root does not match the parent root of its block");
  }
  if (!byteArrayEquals(ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.payload), bid.payloadRoot)) {
    throw new ApiError(400, "Envelope payload does not match the payload root of the bid of its block");
  }
  if (
    !byteArrayEquals(ssz.gloas.ExecutionRequests.hashTreeRoot(envelope.executionRequests), bid.executionRequestsRoot)
  ) {
    throw new ApiError(400, "Envelope execution requests do not match the execution requests root of the bid");
  }
}

async function reconstructBuilderSignedBlockContents(
  chain: ApiModules["chain"],
  signedBlindedBlock: WithOptionalBytes<SignedBlindedBeaconBlock>
): Promise<SignedBlockContents> {
  const executionBuilder = chain.executionBuilder;
  if (!executionBuilder) {
    throw Error("executionBuilder required to publish SignedBlindedBeaconBlock");
  }

  return executionBuilder.submitBlindedBlock(signedBlindedBlock);
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
