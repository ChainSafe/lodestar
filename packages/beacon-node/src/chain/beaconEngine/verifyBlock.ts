import {ProtoBlock} from "@lodestar/fork-choice";
import {DataAvailabilityStatus, computeEpochAtSlot} from "@lodestar/state-transition";
import {IndexedAttestation} from "@lodestar/types";
import {IBlockInput} from "../blocks/blockInput/index.js";
import {ImportBlockOpts} from "../blocks/types.js";
import {verifyBlocksSignatures} from "../blocks/verifyBlocksSignatures.js";
import {verifyBlocksStateTransitionOnly} from "../blocks/verifyBlocksStateTransitionOnly.js";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {BlockProcessOpts} from "../options.js";
import {RegenCaller} from "../regen/index.js";
import {BeaconEngine} from "./beaconEngine.js";

/**
 * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/blocks/verifyBlock.ts#verifyBlocksInEpoch.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export async function verifyBlocks(
  this: BeaconEngine,
  // [beacon-engine] deviation: bytes/POJO seam leaves DA and EL verification in the facade until Step 6.
  _blockBytes: Uint8Array[],
  parentBlock: ProtoBlock,
  blockInputs: IBlockInput[],
  opts: BlockProcessOpts & ImportBlockOpts,
  signal: AbortSignal
): Promise<{verifyStateTime: number; verifySignaturesTime: number}> {
  // [beacon-engine] deviation: verify consensus only and retain post-states in the engine-owned bundle cache.
  const blocks = blockInputs.map((bi) => bi.getBlock());
  const block0 = blocks[0];
  if (!block0) throw Error("Empty blockInputs");
  const block0Epoch = computeEpochAtSlot(block0.message.slot);
  const fork = this.config.getForkSeq(block0.message.slot);

  const preState0 = await this.regen
    .getPreState(block0.message, {dontTransferCache: false}, RegenCaller.processBlocksInEpoch)
    .catch((e) => {
      throw new BlockError(block0, {code: BlockErrorCode.PRESTATE_MISSING, error: e as Error});
    });

  this.shufflingCache.processState(preState0);

  // [beacon-engine] deviation: retain branch omission of upstream pre-state SSZ-cache diagnostic logs.
  if (block0Epoch !== computeEpochAtSlot(preState0.slot)) {
    throw Error(`preState at slot ${preState0.slot} must be dialed to block epoch ${block0Epoch}`);
  }

  // [beacon-engine] deviation: index attestations before the consensus-only parallel verification.
  const indexedAttestationsByBlock: IndexedAttestation[][] = [];
  for (const [i, block] of blocks.entries()) {
    indexedAttestationsByBlock[i] = block.message.body.attestations.map((attestation) => {
      const attEpoch = computeEpochAtSlot(attestation.data.slot);
      const decisionRoot = preState0.getShufflingDecisionRoot(attEpoch);
      return this.shufflingCache.getIndexedAttestation(attEpoch, decisionRoot, fork, attestation);
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
  const [{postStates, proposerBalanceDeltas, verifyStateTime}, {verifySignaturesTime}] = await Promise.all([
    verifyBlocksStateTransitionOnly(
      this.config,
      preState0,
      blockInputs,
      // [beacon-engine] deviation: DA gates import facade-side, outside consensus verification.
      blocks.map(() => DataAvailabilityStatus.Available),
      this.logger,
      this.metrics,
      this.validatorMonitor,
      signal,
      stfOpts
    ),
    opts.skipVerifyBlockSignatures !== true
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

  // [beacon-engine] deviation: retain verification bundles instead of returning FullyVerifiedBlock state objects.
  for (let i = 0; i < blockInputs.length; i++) {
    const blockInput = blockInputs[i];
    const blockRootHex = blockInput.blockRootHex;
    this.verifiedBlocks.set(blockRootHex, {
      postState: postStates[i],
      blockInput,
      indexedAttestations: indexedAttestationsByBlock[i],
      proposerBalanceDelta: proposerBalanceDeltas[i],
      parentBlockSlot: i === 0 ? parentBlock.slot : blocks[i - 1].message.slot,
      seenTimestampSec: opts.seenTimestampSec ?? Math.floor(Date.now() / 1000),
    });
  }

  return {verifyStateTime, verifySignaturesTime};
}
