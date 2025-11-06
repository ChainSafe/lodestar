import {
  computeStartSlotAtEpoch,
} from "@lodestar/state-transition";
import {gloas} from "@lodestar/types";
import {ExecutionPayloadEnvelopeError, ExecutionPayloadEnvelopeErrorCode, GossipAction} from "../errors/index.js";
import {IBeaconChain} from "../index.js";
import { toRootHex } from "@lodestar/utils";

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
  exeuctionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
): Promise<void> {
  const envelope = exeuctionPayloadEnvelope.message;
  const _payload = envelope.payload;

  //  GLOAS: [IGNORE] The envelope's block root `envelope.block_root` has been seen (via
  //  gossip or non-gossip sources) (a client MAY queue payload for processing once
  //  the block is retrieved).
  // TODO GLOAS: Need to review this
  const block = chain.forkChoice.getBlock(envelope.beaconBlockRoot);
  if (block === null ) {
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
      code: ExecutionPayloadEnvelopeErrorCode.SLOT_MISTACH,
      envelopeSlot: envelope.slot,
      blockSlot: block.slot,
    });
  }

  // [REJECT] `envelope.builder_index == bid.builder_index`
  // [REJECT] `payload.block_hash == bid.block_hash`
  // TODO GLOAS: need to get bid from somewhere

  
  // [REJECT] `signed_execution_payload_envelope.signature` is valid with respect to the builder's public key.
  // TODO GLOAS: implement this
}
