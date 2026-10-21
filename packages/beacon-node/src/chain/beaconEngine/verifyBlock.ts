import {ExecutionStatus} from "@lodestar/fork-choice";
import {ForkPostGloas, isForkPostGloas} from "@lodestar/params";
import {
  DataAvailabilityStatus,
  computeEpochAtSlot,
  getIndexedAttestation,
  signedBlockToSignedHeader,
} from "@lodestar/state-transition";
import {IndexedAttestation, SignedBeaconBlock, isGloasBeaconBlock} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {callInNextEventLoop} from "../../util/eventLoop.js";
import {BlockBytes} from "../blocks/blockSerializedCache.js";
import {SegmentExecStatus, verifyBlocksExecutionPayload} from "../blocks/verifyBlocksExecutionPayloads.js";
import {verifyBlocksSignatures} from "../blocks/verifyBlocksSignatures.js";
import {verifyBlocksStateTransitionOnly} from "../blocks/verifyBlocksStateTransitionOnly.js";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {RegenCaller} from "../regen/index.js";
import {BeaconEngineCore} from "./beaconEngineCore.js";
import {VerifyBlocksOpts, VerifyBlocksSuccess} from "./interface.js";

/**
 * Runs inside BeaconEngineCore. Moved from unstable@ba0411b482 packages/beacon-node/src/chain/blocks/verifyBlock.ts#verifyBlocksInEpoch.
 * Synced through unstable@2593063a82.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export async function verifyBlocks(
  this: BeaconEngineCore,
  // [beacon-engine] deviation: bytes/POJO seam leaves DA verification in the facade.
  blockData: BlockBytes[],
  opts: VerifyBlocksOpts,
  isApiValidation = false
): Promise<VerifyBlocksSuccess> {
  const entries = blockData.map(({blockRoot, blockBytes}) =>
    this.blockSerializedCache.getOrDeserialize(toRootHex(blockRoot), blockBytes)
  );
  const blocks = entries.map(({block}) => block);
  const blockBytes = entries.map(({bytes}) => bytes);
  for (const block of blocks) {
    const forkName = this.config.getForkName(block.message.slot);
    if (isForkPostGloas(forkName)) {
      this.seenPayloadEnvelopeInputCache.add({
        blockRootHex: toRootHex(this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message)),
        block: block as SignedBeaconBlock<ForkPostGloas>,
        forkName,
      });
    }
  }

  // [beacon-engine] deviation: verify consensus and EL internally and retain post-states in the engine-owned bundle cache.
  const block0 = blocks[0];
  if (!block0) throw Error("Empty blocks");
  const parentRoot = toRootHex(block0.message.parentRoot);
  let parentBlock = this.forkChoice.getBlockHexDefaultStatus(parentRoot);
  if (!parentBlock) throw new BlockError(block0, {code: BlockErrorCode.PARENT_BLOCK_UNKNOWN, parentRoot});
  if (isGloasBeaconBlock(block0.message)) {
    const parentBlockHash = toRootHex(block0.message.body.signedExecutionPayloadBid.message.parentBlockHash);
    parentBlock = this.forkChoice.getBlockHexAndBlockHash(parentRoot, parentBlockHash) ?? parentBlock;
  }
  const block0Epoch = computeEpochAtSlot(block0.message.slot);
  const fork = this.config.getForkSeq(block0.message.slot);

  const preState0 = await this.regen
    .getPreState(block0.message, {dontTransferCache: false}, RegenCaller.processBlocksInEpoch)
    .catch((e) => {
      throw new BlockError(block0, {code: BlockErrorCode.PRESTATE_MISSING, error: e as Error});
    });

  // [beacon-engine] deviation: retain branch omission of upstream pre-state SSZ-cache diagnostic logs.
  if (block0Epoch !== computeEpochAtSlot(preState0.slot)) {
    throw Error(`preState at slot ${preState0.slot} must be dialed to block epoch ${block0Epoch}`);
  }

  // [beacon-engine] deviation: index attestations before the parallel verification.
  const indexedAttestationsByBlock: IndexedAttestation[][] = [];
  for (const [i, block] of blocks.entries()) {
    indexedAttestationsByBlock[i] = block.message.body.attestations.map((attestation) => {
      const attEpoch = computeEpochAtSlot(attestation.data.slot);
      const shuffling =
        this.shufflingCache.getSync(attEpoch, preState0.getShufflingDecisionRoot(attEpoch)) ??
        preState0.getShufflingAtEpoch(attEpoch);
      return getIndexedAttestation(shuffling, fork, attestation);
    });
  }

  // Fold the engine-owned invalid-SSZ persist config into the STF opts so the engine (not the facade)
  // persists invalid pre/post states on STF failure (keeps IBeaconStateView off BlockError).
  // [beacon-engine] deviation: engine owns invalid-state persistence settings.
  const stfOpts = {
    ...opts,
    persistInvalidSszObjects: this.opts.persistInvalidSszObjects,
    persistInvalidSszObjectsDir: this.opts.persistInvalidSszObjectsDir,
  };
  const abortController = new AbortController();
  try {
    // [beacon-engine] deviation: reject EL failures internally so the facade aborts its concurrent DA wait.
    const verifyExecutionPayloadsPromise =
      opts.skipVerifyExecutionPayload !== true
        ? verifyBlocksExecutionPayload(this, parentBlock, blocks, preState0, abortController.signal, opts)
        : Promise.resolve<SegmentExecStatus>({
            execAborted: null,
            executionStatuses: blocks.map(() => ExecutionStatus.Syncing),
            executionTime: Date.now(),
          });
    const [segmentExecStatus, {postStates, proposerBalanceDeltas, verifyStateTime}, {verifySignaturesTime}] =
      await Promise.all([
        verifyExecutionPayloadsPromise,
        verifyBlocksStateTransitionOnly(
          this.config,
          preState0,
          blocks,
          // [beacon-engine] deviation: DA gates import facade-side, outside consensus verification.
          blocks.map(() => DataAvailabilityStatus.Available),
          // [beacon-engine] deviation: retain the bytes paired with the cached block across worker calls.
          blockBytes,
          this.logger,
          this.metrics,
          this.validatorMonitor,
          abortController.signal,
          stfOpts
        ),
        opts.validSignatures !== true
          ? verifyBlocksSignatures(
              this.config,
              this.bls,
              this.logger,
              this.metrics,
              preState0,
              blocks,
              indexedAttestationsByBlock,
              stfOpts
            )
          : Promise.resolve({verifySignaturesTime: Date.now()}),
      ]);

    // Source: unstable@708700cdf6 packages/beacon-node/src/chain/blocks/verifyBlock.ts#verifyBlocksInEpoch, proposer observation loop.
    // [beacon-engine] deviation: authenticated headers are retained independently of the facade DA wait.
    for (const [i, block] of blocks.entries()) {
      const {slot, proposerIndex} = block.message;
      const signedBlockHeader = signedBlockToSignedHeader(this.config, block);
      this.seenBlockProposers.observeBlockRoot(
        slot,
        proposerIndex,
        toRootHex(blockData[i].blockRoot),
        signedBlockHeader
      );
      // Only produce a slashing while importing the block. A block that is verified before it is published
      // must not be treated as equivocation evidence since it may never be seen by the network
      if (!isApiValidation && this.seenBlockProposers.isEquivocating(slot, proposerIndex)) {
        callInNextEventLoop(() => this.processProposerEquivocation(slot, proposerIndex));
      }
    }

    // [beacon-engine] deviation: keep invalid-ancestor propagation engine-owned after consensus verification.
    if (segmentExecStatus.execAborted !== null) {
      if (segmentExecStatus.invalidSegmentLVH !== undefined) {
        this.forkChoice.validateLatestHash(segmentExecStatus.invalidSegmentLVH);
      }
      throw segmentExecStatus.execAborted.execError;
    }

    // [beacon-engine] deviation: retain verification bundles instead of returning FullyVerifiedBlock state objects.
    // API validation may reject publication after consensus succeeds. Its post-states must stay local
    // to this call, and it must not overwrite a bundle belonging to a concurrent import of the same root.
    if (!isApiValidation) {
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const blockRootHex = toRootHex(blockData[i].blockRoot);
        this.verifiedBlocks.set(blockRootHex, {
          executionStatus: segmentExecStatus.executionStatuses[i],
          postState: postStates[i],
          block,
          blockBytes: blockBytes[i],
          indexedAttestations: indexedAttestationsByBlock[i],
          proposerBalanceDelta: proposerBalanceDeltas[i],
          parentBlockSlot: i === 0 ? parentBlock.slot : blocks[i - 1].message.slot,
          seenTimestampSec: opts.seenTimestampSec ?? Math.floor(Date.now() / 1000),
        });
      }
    }

    return {segmentExecStatus, verifyStateTime, verifySignaturesTime};
  } finally {
    abortController.abort();
  }
}
