import {readOnlyMap, toHexString} from "@chainsafe/ssz";
import {Attestation, Checkpoint, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {toJson} from "@chainsafe/lodestar-utils";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";

import {ITreeStateContext} from "../db/api/beacon/stateContextCache";
import {AttestationError, AttestationErrorCode, BlockError, BlockErrorCode} from "./errors";
import {IBlockJob} from "./interface";
import {BeaconChain} from "../chain";

/**
 * Attach ChainEventEmitter event handlers
 * Listen on `signal` to remove event handlers
 */
export function handleChainEvents(chain: BeaconChain, signal: AbortSignal): void {
  const _onClockSlot = onClockSlot.bind(chain);
  const _onForkVersion = onForkVersion.bind(chain);
  const _onCheckpoint = onCheckpoint.bind(chain);
  const _onJustified = onJustified.bind(chain);
  const _onFinalized = onFinalized.bind(chain);
  const _onForkChoiceJustified = onForkChoiceJustified.bind(chain);
  const _onForkChoiceFinalized = onForkChoiceFinalized.bind(chain);
  const _onForkChoiceHead = onForkChoiceHead.bind(chain);
  const _onForkChoiceReorg = onForkChoiceReorg.bind(chain);
  const _onAttestation = onAttestation.bind(chain);
  const _onBlock = onBlock.bind(chain);
  const _onErrorAttestation = onErrorAttestation.bind(chain);
  const _onErrorBlock = onErrorBlock.bind(chain);

  chain.emitter.on("clock:slot", _onClockSlot);
  chain.emitter.on("forkVersion", _onForkVersion);
  chain.emitter.on("checkpoint", _onCheckpoint);
  chain.emitter.on("justified", _onJustified);
  chain.emitter.on("finalized", _onFinalized);
  chain.emitter.on("forkChoice:justified", _onForkChoiceJustified);
  chain.emitter.on("forkChoice:finalized", _onForkChoiceFinalized);
  chain.emitter.on("forkChoice:head", _onForkChoiceHead);
  chain.emitter.on("forkChoice:reorg", _onForkChoiceReorg);
  chain.emitter.on("attestation", _onAttestation);
  chain.emitter.on("block", _onBlock);
  chain.emitter.on("error:attestation", _onErrorAttestation);
  chain.emitter.on("error:block", _onErrorBlock);

  signal.addEventListener(
    "abort",
    () => {
      chain.emitter.removeListener("clock:slot", _onClockSlot);
      chain.emitter.removeListener("forkVersion", _onForkVersion);
      chain.emitter.removeListener("checkpoint", _onCheckpoint);
      chain.emitter.removeListener("justified", _onJustified);
      chain.emitter.removeListener("finalized", _onFinalized);
      chain.emitter.removeListener("forkChoice:justified", _onForkChoiceJustified);
      chain.emitter.removeListener("forkChoice:finalized", _onForkChoiceFinalized);
      chain.emitter.removeListener("forkChoice:head", _onForkChoiceHead);
      chain.emitter.removeListener("forkChoice:reorg", _onForkChoiceReorg);
      chain.emitter.removeListener("attestation", _onAttestation);
      chain.emitter.removeListener("block", _onBlock);
      chain.emitter.removeListener("error:attestation", _onErrorAttestation);
      chain.emitter.removeListener("error:block", _onErrorBlock);
    },
    {once: true}
  );
}

export async function onClockSlot(this: BeaconChain, slot: Slot): Promise<void> {
  this.logger.verbose("Clock slot", {slot});
  this.forkChoice.updateTime(slot);
  await Promise.all(
    // Attestations can only affect the fork choice of subsequent slots.
    // Process the attestations in `slot - 1`, rather than `slot`
    this.pendingAttestations.getBySlot(slot - 1).map((job) => {
      this.pendingAttestations.remove(job);
      return this.attestationProcessor.processAttestationJob(job);
    })
  );
  await Promise.all(
    this.pendingBlocks.getBySlot(slot).map((job) => {
      this.pendingBlocks.remove(job);
      return this.blockProcessor.processBlockJob(job);
    })
  );
}

export async function onForkVersion(this: BeaconChain): Promise<void> {
  this._currentForkDigest = await this.getCurrentForkDigest();
  this.emitter.emit("forkDigest", this._currentForkDigest);
}

export async function onCheckpoint(this: BeaconChain, cp: Checkpoint, stateContext: ITreeStateContext): Promise<void> {
  this.logger.verbose("Checkpoint processed", this.config.types.Checkpoint.toJson(cp));
  await this.db.checkpointStateCache.add(cp, stateContext);
  this.metrics.currentEpochLiveValidators.set(stateContext.epochCtx.currentShuffling.activeIndices.length);
  const parentBlockSummary = await this.forkChoice.getBlock(stateContext.state.latestBlockHeader.parentRoot);
  if (parentBlockSummary) {
    const justifiedCheckpoint = stateContext.state.currentJustifiedCheckpoint;
    const justifiedEpoch = justifiedCheckpoint.epoch;
    const preJustifiedEpoch = parentBlockSummary.justifiedEpoch;
    if (justifiedEpoch > preJustifiedEpoch) {
      this.emitter.emit("justified", justifiedCheckpoint, stateContext);
    }
    const finalizedCheckpoint = stateContext.state.finalizedCheckpoint;
    const finalizedEpoch = finalizedCheckpoint.epoch;
    const preFinalizedEpoch = parentBlockSummary.finalizedEpoch;
    if (finalizedEpoch > preFinalizedEpoch) {
      this.emitter.emit("finalized", finalizedCheckpoint, stateContext);
    }
  }
}

export async function onJustified(this: BeaconChain, cp: Checkpoint, stateContext: ITreeStateContext): Promise<void> {
  this.logger.important("Checkpoint justified", this.config.types.Checkpoint.toJson(cp));
  this.metrics.previousJustifiedEpoch.set(stateContext.state.previousJustifiedCheckpoint.epoch);
  this.metrics.currentJustifiedEpoch.set(cp.epoch);
}

export async function onFinalized(this: BeaconChain, cp: Checkpoint): Promise<void> {
  this.logger.important("Checkpoint finalized", this.config.types.Checkpoint.toJson(cp));
  this.metrics.currentFinalizedEpoch.set(cp.epoch);
}

export async function onForkChoiceJustified(this: BeaconChain, cp: Checkpoint): Promise<void> {
  this.logger.verbose("Fork choice justified", this.config.types.Checkpoint.toJson(cp));
}

export async function onForkChoiceFinalized(this: BeaconChain, cp: Checkpoint): Promise<void> {
  this.logger.verbose("Fork choice finalized", this.config.types.Checkpoint.toJson(cp));
}

export async function onForkChoiceHead(this: BeaconChain, head: IBlockSummary): Promise<void> {
  this.logger.verbose("New chain head", {
    headSlot: head.slot,
    headRoot: toHexString(head.blockRoot),
  });
}

export async function onForkChoiceReorg(
  this: BeaconChain,
  head: IBlockSummary,
  oldHead: IBlockSummary,
  depth: number
): Promise<void> {
  this.logger.verbose("Chain reorg", {
    depth,
  });
}

export async function onAttestation(this: BeaconChain, attestation: Attestation): Promise<void> {
  this.logger.debug("Attestation processed", {
    slot: attestation.data.slot,
    index: attestation.data.index,
    targetRoot: toHexString(attestation.data.target.root),
    aggregationBits: this.config.types.CommitteeBits.toJson(attestation.aggregationBits),
  });
}

export async function onBlock(
  this: BeaconChain,
  block: SignedBeaconBlock,
  postStateContext: ITreeStateContext,
  job: IBlockJob
): Promise<void> {
  const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(block.message);
  this.logger.debug("Block processed", {
    slot: block.message.slot,
    root: toHexString(blockRoot),
  });
  this.metrics.currentSlot.set(block.message.slot);
  await this.db.stateCache.add(postStateContext);
  if (!job.reprocess) {
    await this.db.block.add(block);
  }
  if (!job.trusted) {
    // Only process attestations in response to an "untrusted" block
    await Promise.all([
      // process the attestations in the block
      ...readOnlyMap(block.message.body.attestations, (attestation) => {
        return this.attestationProcessor.processAttestationJob({
          attestation,
          // attestation signatures from blocks have already been verified
          validSignature: true,
        });
      }),
      // process pending attestations which needed the block
      ...this.pendingAttestations.getByBlock(blockRoot).map((job) => {
        this.pendingAttestations.remove(job);
        return this.attestationProcessor.processAttestationJob(job);
      }),
    ]);
  }
  await this.db.processBlockOperations(block);
  await Promise.all(
    this.pendingBlocks.getByParent(blockRoot).map((job) => {
      this.pendingBlocks.remove(job);
      return this.blockProcessor.processBlockJob(job);
    })
  );
}

export async function onErrorAttestation(this: BeaconChain, err: AttestationError): Promise<void> {
  if (!(err instanceof AttestationError)) {
    this.logger.error("Non AttestationError received:", err);
    return;
  }
  this.logger.debug("Attestation error", toJson(err));
  const attestationRoot = this.config.types.Attestation.hashTreeRoot(err.job.attestation);
  switch (err.type.code) {
    case AttestationErrorCode.ERR_FUTURE_SLOT:
      this.logger.debug("Add attestation to pool", {
        reason: err.type.code,
        attestationRoot: toHexString(attestationRoot),
      });
      this.pendingAttestations.putBySlot(err.type.attestationSlot, err.job);
      break;
    case AttestationErrorCode.ERR_UNKNOWN_TARGET_ROOT:
      this.logger.debug("Add attestation to pool", {
        reason: err.type.code,
        attestationRoot: toHexString(attestationRoot),
      });
      this.pendingAttestations.putByBlock(err.type.root, err.job);
      break;
    case AttestationErrorCode.ERR_UNKNOWN_HEAD_BLOCK:
      this.pendingAttestations.putByBlock(err.type.beaconBlockRoot, err.job);
      break;
    default:
      await this.db.attestation.remove(err.job.attestation);
  }
}

export async function onErrorBlock(this: BeaconChain, err: BlockError): Promise<void> {
  if (!(err instanceof BlockError)) {
    this.logger.error("Non BlockError received:", err);
    return;
  }
  this.logger.debug("Block error", toJson(err));
  const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(err.job.signedBlock.message);
  switch (err.type.code) {
    case BlockErrorCode.ERR_FUTURE_SLOT:
      this.logger.debug("Add block to pool", {
        reason: err.type.code,
        blockRoot: toHexString(blockRoot),
      });
      this.pendingBlocks.addBySlot(err.job);
      break;
    case BlockErrorCode.ERR_PARENT_UNKNOWN:
      this.logger.debug("Add block to pool", {
        reason: err.type.code,
        blockRoot: toHexString(blockRoot),
      });
      this.pendingBlocks.addByParent(err.job);
      break;
    case BlockErrorCode.ERR_INCORRECT_PROPOSER:
    case BlockErrorCode.ERR_REPEAT_PROPOSAL:
    case BlockErrorCode.ERR_STATE_ROOT_MISMATCH:
    case BlockErrorCode.ERR_PER_BLOCK_PROCESSING_ERROR:
    case BlockErrorCode.ERR_BLOCK_IS_NOT_LATER_THAN_PARENT:
    case BlockErrorCode.ERR_UNKNOWN_PROPOSER:
      await this.db.badBlock.put(blockRoot);
      this.logger.warn("Found bad block", {
        blockRoot: toHexString(blockRoot),
        error: toJson(err),
      });
      break;
  }
}
