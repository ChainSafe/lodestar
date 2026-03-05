import {PublicKey} from "@chainsafe/blst";
import {
  CachedBeaconStateGloas,
  computeStartSlotAtEpoch,
  createSingleSignatureSetFromComponents,
  getExecutionPayloadEnvelopeSigningRoot,
} from "@lodestar/state-transition";
import {gloas} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionPayloadEnvelopeError, ExecutionPayloadEnvelopeErrorCode, GossipAction} from "../errors/index.js";
import {IBeaconChain} from "../index.js";
import {RegenCaller} from "../regen/index.js";

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
  const {payload} = envelope;
  const blockRootHex = toRootHex(envelope.beaconBlockRoot);

  // [IGNORE] The envelope's block root `envelope.block_root` has been seen (via
  // gossip or non-gossip sources) (a client MAY queue payload for processing once
  // the block is retrieved).
  // TODO GLOAS: Need to review this, we should queue the envelope for later
  // processing if the block is not yet known, otherwise we would ignore it here
  const block = chain.forkChoice.getBlockDefaultStatus(envelope.beaconBlockRoot);
  if (block === null) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.BLOCK_ROOT_UNKNOWN,
      blockRoot: blockRootHex,
    });
  }

  // [IGNORE] The node has not seen another valid
  // `SignedExecutionPayloadEnvelope` for this block root from this builder.
  const payloadInput = chain.seenPayloadEnvelopeInput.get(blockRootHex);
  if (!payloadInput) {
    // PayloadEnvelopeInput should have been created during block import
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.CACHE_FAIL,
      blockRoot: blockRootHex,
    });
  }

  // [IGNORE] The node has not seen another valid
  // `SignedExecutionPayloadEnvelope` for this block root from this builder.
  if (payloadInput.hasPayloadEnvelope()) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN,
      blockRoot: blockRootHex,
      slot: envelope.slot,
    });
  }

  // [IGNORE] The envelope is from a slot greater than or equal to the latest finalized slot -- i.e. validate that `envelope.slot >= compute_start_slot_at_epoch(store.finalized_checkpoint.epoch)`
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
  // TODO GLOAS: implement this. Technically if we cannot get proto block from fork choice,
  // it is possible that the block didn't pass the validation

  // [REJECT] `block.slot` equals `envelope.slot`.
  if (block.slot !== envelope.slot) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.SLOT_MISMATCH,
      envelopeSlot: envelope.slot,
      blockSlot: block.slot,
    });
  }

  // [REJECT] `envelope.builder_index == bid.builder_index`
  if (envelope.builderIndex !== payloadInput.getBuilderIndex()) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.BUILDER_INDEX_MISMATCH,
      envelopeBuilderIndex: envelope.builderIndex,
      bidBuilderIndex: payloadInput.getBuilderIndex(),
    });
  }

  // [REJECT] `payload.block_hash == bid.block_hash`
  if (toRootHex(payload.blockHash) !== payloadInput.getBlockHashHex()) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH,
      envelopeBlockHash: toRootHex(payload.blockHash),
      bidBlockHash: payloadInput.getBlockHashHex(),
    });
  }

  // [REJECT] `signed_execution_payload_envelope.signature` is valid with respect to the builder's public key.
  const parentRoot = block.parentRoot;
  const parentBlock = chain.forkChoice.getBlockHex(parentRoot);
  if (parentBlock === null) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.PARENT_UNKNOWN,
      parentRoot,
      slot: envelope.slot,
    });
  }

  const blockState = await chain.regen
    .getBlockSlotState(parentBlock, block.slot, {dontTransferCache: true}, RegenCaller.validateGossipBlock)
    .catch(() => {
      throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
        code: ExecutionPayloadEnvelopeErrorCode.PARENT_UNKNOWN,
        parentRoot,
        slot: envelope.slot,
      });
    });

  const signatureSet = createSingleSignatureSetFromComponents(
    PublicKey.fromBytes((blockState as CachedBeaconStateGloas).builders.getReadonly(envelope.builderIndex).pubkey),
    getExecutionPayloadEnvelopeSigningRoot(chain.config, envelope),
    executionPayloadEnvelope.signature
  );

  if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.INVALID_SIGNATURE,
    });
  }
}
