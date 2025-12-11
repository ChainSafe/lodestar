import {
  computeStartSlotAtEpoch,
  createSingleSignatureSetFromComponents,
  getExecutionPayloadSigningRoot,
} from "@lodestar/state-transition";
import {gloas} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionPayloadEnvelopeError, ExecutionPayloadEnvelopeErrorCode, GossipAction} from "../errors/index.js";
import {IBeaconChain} from "../index.js";

export async function validateApiExecutionPayloadEnvelope(
  chain: IBeaconChain,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
): Promise<void> {
  return validateExecutionPayloadEnvelope(chain, executionPayloadEnvelope);
}

export async function validateGossipExecutionPayloadEnvelope(
  chain: IBeaconChain,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
): Promise<void> {
  return validateExecutionPayloadEnvelope(chain, executionPayloadEnvelope);
}

async function validateExecutionPayloadEnvelope(
  chain: IBeaconChain,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
): Promise<void> {
  const envelope = executionPayloadEnvelope.message;
  const {builderIndex, payload} = envelope;

  //  GLOAS: [IGNORE] The envelope's block root `envelope.block_root` has been seen (via
  //  gossip or non-gossip sources) (a client MAY queue payload for processing once
  //  the block is retrieved).
  // TODO GLOAS: Need to review this
  const block = chain.forkChoice.getBlock(envelope.beaconBlockRoot);
  if (block === null) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.BLOCK_ROOT_UNKNOWN,
      blockRoot: toRootHex(envelope.beaconBlockRoot),
    });
  }

  //  [IGNORE] The node has not seen another valid
  //  `SignedExecutionPayloadEnvelope` for this block root from this builder.
  // TODO GLOAS: implement this

  //  [IGNORE] The envelope is from a slot greater than or equal to the latest finalized slot -- i.e. validate that `envelope.slot >= compute_start_slot_at_epoch(store.finalized_checkpoint.epoch)`
  const finalizedCheckpoint = chain.forkChoice.getFinalizedCheckpoint();
  const finalizedSlot = computeStartSlotAtEpoch(finalizedCheckpoint.epoch);
  if (envelope.slot < finalizedSlot) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.BELONG_TO_FINALIZED_BLOCK,
      envelopeSlot: envelope.slot,
      finalizedSlot,
    });
  }

  // [REJECT] `block` passes validation.
  // TODO GLOAS: implement this

  // [REJECT] `block.slot` equals `envelope.slot`.
  if (block.slot !== envelope.slot) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.SLOT_MISMATCH,
      envelopeSlot: envelope.slot,
      blockSlot: block.slot,
    });
  }

  if (block.builderIndex === undefined || block.blockHashHex === undefined) {
    // Cache fail. This should not happen
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.CACHE_FAIL,
      blockRoot: toRootHex(envelope.beaconBlockRoot),
    });
  }

  // [REJECT] `envelope.builder_index == bid.builder_index`
  if (builderIndex !== block.builderIndex) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.BUILDER_INDEX_MISMATCH,
      envelopeBuilderIndex: builderIndex,
      bidBuilderIndex: block.builderIndex,
    });
  }

  // [REJECT] `payload.block_hash == bid.block_hash`
  if (toRootHex(payload.blockHash) !== block.blockHashHex) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH,
      envelopeBlockHash: toRootHex(payload.blockHash),
      bidBlockHash: block.blockHashHex,
    });
  }

  // [REJECT] `signed_execution_payload_envelope.signature` is valid with respect to the builder's public key.
  const signatureSet = createSingleSignatureSetFromComponents(
    chain.index2pubkey[envelope.builderIndex],
    getExecutionPayloadSigningRoot({config: chain.config, slot: envelope.slot}, payload),
    executionPayloadEnvelope.signature
  );

  if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.INVALID_SIGNATURE,
    });
  }
}
