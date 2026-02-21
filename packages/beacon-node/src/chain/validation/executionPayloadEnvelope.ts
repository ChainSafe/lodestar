import {PublicKey} from "@chainsafe/blst";
import {BUILDER_INDEX_SELF_BUILD} from "@lodestar/params";
import {
  CachedBeaconStateGloas,
  computeStartSlotAtEpoch,
  createSingleSignatureSetFromComponents,
  getExecutionPayloadEnvelopeSigningRoot,
} from "@lodestar/state-transition";
import {gloas, isGloasBeaconBlock} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionPayloadEnvelopeError, ExecutionPayloadEnvelopeErrorCode, GossipAction} from "../errors/index.js";
import {IBeaconChain} from "../index.js";
import {RegenCaller} from "../regen/index.js";

export async function validateApiExecutionPayloadEnvelope(
  chain: IBeaconChain,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
): Promise<void> {
  return validateExecutionPayloadEnvelope(chain, executionPayloadEnvelope, RegenCaller.restApi);
}

export async function validateGossipExecutionPayloadEnvelope(
  chain: IBeaconChain,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
): Promise<void> {
  return validateExecutionPayloadEnvelope(
    chain,
    executionPayloadEnvelope,
    RegenCaller.validateGossipExecutionPayloadEnvelope
  );
}

async function validateExecutionPayloadEnvelope(
  chain: IBeaconChain,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
  regenCaller: RegenCaller
): Promise<void> {
  const envelope = executionPayloadEnvelope.message;
  const {payload} = envelope;
  const blockRootHex = toRootHex(envelope.beaconBlockRoot);

  // [IGNORE] The envelope's block root `envelope.block_root` has been seen (via
  // gossip or non-gossip sources) (a client MAY queue payload for processing once
  // the block is retrieved).
  // TODO GLOAS: Need to review this, we should queue the envelope for later
  // processing if the block is not yet known, otherwise we would ignore it here
  const block = chain.forkChoice.getBlock(envelope.beaconBlockRoot);
  if (block === null) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.BLOCK_ROOT_UNKNOWN,
      blockRoot: blockRootHex,
    });
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

  const blockByRoot = await chain.getBlockByRoot(blockRootHex);
  if (blockByRoot === null) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.CACHE_FAIL,
      blockRoot: blockRootHex,
    });
  }
  const fullBlock = blockByRoot.block;

  // [REJECT] `block.slot` equals `envelope.slot`.
  if (fullBlock.message.slot !== envelope.slot) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.SLOT_MISMATCH,
      envelopeSlot: envelope.slot,
      blockSlot: fullBlock.message.slot,
    });
  }

  if (!isGloasBeaconBlock(fullBlock.message)) {
    // This should never happen
    throw new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
      code: ExecutionPayloadEnvelopeErrorCode.CACHE_FAIL,
      blockRoot: blockRootHex,
    });
  }
  const bid = fullBlock.message.body.signedExecutionPayloadBid.message;

  // [REJECT] `envelope.builder_index == bid.builder_index`
  if (envelope.builderIndex !== bid.builderIndex) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.BUILDER_INDEX_MISMATCH,
      envelopeBuilderIndex: envelope.builderIndex,
      bidBuilderIndex: bid.builderIndex,
    });
  }

  // [REJECT] `payload.block_hash == bid.block_hash`
  const bidBlockHashHex = toRootHex(bid.blockHash);
  if (toRootHex(payload.blockHash) !== bidBlockHashHex) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH,
      envelopeBlockHash: toRootHex(payload.blockHash),
      bidBlockHash: bidBlockHashHex,
    });
  }

  // [REJECT] `signed_execution_payload_envelope.signature` is valid according to
  // `verify_execution_payload_envelope_signature`.
  // For self-builds use the block proposer's pubkey, otherwise use the builder's pubkey.
  let signerPubkey: PublicKey;
  if (envelope.builderIndex === BUILDER_INDEX_SELF_BUILD) {
    signerPubkey = chain.index2pubkey[fullBlock.message.proposerIndex];
  } else {
    const preState = (await chain.regen.getState(
      toRootHex(fullBlock.message.stateRoot),
      regenCaller
    )) as CachedBeaconStateGloas;
    signerPubkey = PublicKey.fromBytes(preState.builders.getReadonly(envelope.builderIndex).pubkey);
  }

  const signatureSet = createSingleSignatureSetFromComponents(
    signerPubkey,
    getExecutionPayloadEnvelopeSigningRoot(chain.config, envelope),
    executionPayloadEnvelope.signature
  );

  if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
    throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
      code: ExecutionPayloadEnvelopeErrorCode.INVALID_SIGNATURE,
    });
  }

  chain.seenExecutionPayloadEnvelopes.add(blockRootHex, envelope.slot);
}
