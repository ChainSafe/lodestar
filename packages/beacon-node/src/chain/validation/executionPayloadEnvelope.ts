import {PublicKey} from "@chainsafe/blst";
import {BUILDER_INDEX_SELF_BUILD} from "@lodestar/params";
import {
  CachedBeaconStateGloas,
  computeStartSlotAtEpoch,
  createSingleSignatureSetFromComponents,
  getExecutionPayloadEnvelopeSigningRoot,
} from "@lodestar/state-transition";
import {gloas} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import type {PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput.js";
import {ExecutionPayloadEnvelopeError, ExecutionPayloadEnvelopeErrorCode, GossipAction} from "../errors/index.js";
import {IBeaconChain} from "../index.js";

export async function validateApiExecutionPayloadEnvelope(
  chain: IBeaconChain,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
): Promise<void> {
  return validateExecutionPayloadEnvelope(chain, executionPayloadEnvelope);
}

/**
 * Validate an execution payload envelope received via gossip.
 *
 * When `envelopeInput` is provided, bid info (slot, builderIndex, blockHashFromBid)
 * is taken from it instead of looking up the block in fork-choice.  This is critical
 * because the block may have been gossip-validated (creating the cache entry) but not
 * yet fully imported into fork-choice when the envelope arrives.
 */
export async function validateGossipExecutionPayloadEnvelope(
  chain: IBeaconChain,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
  envelopeInput?: PayloadEnvelopeInput
): Promise<void> {
  return validateExecutionPayloadEnvelope(chain, executionPayloadEnvelope, envelopeInput);
}

async function validateExecutionPayloadEnvelope(
  chain: IBeaconChain,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
  envelopeInput?: PayloadEnvelopeInput
): Promise<void> {
  const envelope = executionPayloadEnvelope.message;
  const {payload} = envelope;
  const blockRootHex = toRootHex(envelope.beaconBlockRoot);

  // Use bid info from the envelope input cache if available (gossip path),
  // otherwise fall back to fork-choice lookup (API path / early-envelope replay).
  let bidSlot: number;
  let bidBuilderIndex: number;
  let bidBlockHash: string;

  if (envelopeInput) {
    // Gossip path: bid info from SeenPayloadEnvelopeCache, populated during
    // block gossip validation before the block is imported into fork-choice.
    bidSlot = envelopeInput.slot;
    bidBuilderIndex = envelopeInput.builderIndex;
    bidBlockHash = envelopeInput.blockHashFromBid;
  } else {
    // API / early-envelope path: look up block in fork-choice.
    const block = chain.forkChoice.getBlockDefaultStatus(envelope.beaconBlockRoot);
    if (block === null) {
      throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
        code: ExecutionPayloadEnvelopeErrorCode.BLOCK_ROOT_UNKNOWN,
        blockRoot: blockRootHex,
      });
    }

    if (block.builderIndex == null || block.blockHashFromBid == null) {
      throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
        code: ExecutionPayloadEnvelopeErrorCode.CACHE_FAIL,
        blockRoot: blockRootHex,
      });
    }

    bidSlot = block.slot;
    bidBuilderIndex = block.builderIndex;
    bidBlockHash = block.blockHashFromBid;
  }

  // [IGNORE] The node has not seen another valid
  // `SignedExecutionPayloadEnvelope` for this block root from this builder.
  if (chain.seenExecutionPayloadEnvelopes.isKnown(blockRootHex)) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN,
      blockRoot: blockRootHex,
      slot: envelope.slot,
    });
  }

  // [IGNORE] The envelope is from a slot greater than or equal to the latest finalized slot
  const finalizedCheckpoint = chain.forkChoice.getFinalizedCheckpoint();
  const finalizedSlot = computeStartSlotAtEpoch(finalizedCheckpoint.epoch);
  if (envelope.slot < finalizedSlot) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.BELONG_TO_FINALIZED_BLOCK,
      envelopeSlot: envelope.slot,
      finalizedSlot,
    });
  }

  // [REJECT] `block.slot` equals `envelope.slot`.
  if (bidSlot !== envelope.slot) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.SLOT_MISMATCH,
      envelopeSlot: envelope.slot,
      blockSlot: bidSlot,
    });
  }

  // [REJECT] `envelope.builder_index == bid.builder_index`
  if (envelope.builderIndex !== bidBuilderIndex) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.BUILDER_INDEX_MISMATCH,
      envelopeBuilderIndex: envelope.builderIndex,
      bidBuilderIndex,
    });
  }

  // [REJECT] `payload.block_hash == bid.block_hash`
  if (toRootHex(payload.blockHash) !== bidBlockHash) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH,
      envelopeBlockHash: toRootHex(payload.blockHash),
      bidBlockHash,
    });
  }

  // [REJECT] `signed_execution_payload_envelope.signature` is valid with respect to the builder's public key.
  // Spec: verify_execution_payload_envelope_signature
  // For BUILDER_INDEX_SELF_BUILD: verify against state.validators[state.latest_block_header.proposer_index].pubkey
  // For regular builders: verify against state.builders[builder_index].pubkey
  {
    const state = chain.getHeadState() as CachedBeaconStateGloas;
    let pubkey: Uint8Array;

    if (envelope.builderIndex === BUILDER_INDEX_SELF_BUILD) {
      // Self-build: proposer signs the envelope
      const proposerIndex = state.latestBlockHeader.proposerIndex;
      pubkey = state.validators.getReadonly(proposerIndex).pubkey;
    } else {
      pubkey = state.builders.getReadonly(envelope.builderIndex).pubkey;
    }

    const signatureSet = createSingleSignatureSetFromComponents(
      PublicKey.fromBytes(pubkey),
      getExecutionPayloadEnvelopeSigningRoot(chain.config, envelope),
      executionPayloadEnvelope.signature
    );

    if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
      throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
        code: ExecutionPayloadEnvelopeErrorCode.INVALID_SIGNATURE,
      });
    }
  }

  chain.seenExecutionPayloadEnvelopes.add(blockRootHex, envelope.slot);
}
