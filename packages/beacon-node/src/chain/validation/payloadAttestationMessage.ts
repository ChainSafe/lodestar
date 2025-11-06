import {gloas} from "@lodestar/types";
import {GossipAction, PayloadAttestationError, PayloadAttestationErrorCode} from "../errors/index.ts";
import {IBeaconChain} from "../index.ts";
import { toRootHex } from "@lodestar/utils";

export async function validateApiPayloadAttestationMessage(
  chain: IBeaconChain,
  payloadAttestationMessage: gloas.PayloadAttestationMessage,
): Promise<void> {
  return validatePayloadAttestationMessage(chain, payloadAttestationMessage);
}

export async function validateGossipPayloadAttestationMessage(
  chain: IBeaconChain,
  payloadAttestationMessage: gloas.PayloadAttestationMessage,
): Promise<void> {
  return validatePayloadAttestationMessage(chain, payloadAttestationMessage);
}

async function validatePayloadAttestationMessage(
  chain: IBeaconChain,
  payloadAttestationMessage: gloas.PayloadAttestationMessage,
): Promise<void> {

  const data = payloadAttestationMessage.data;

  // [IGNORE] The message's slot is for the current slot (with a `MAXIMUM_GOSSIP_CLOCK_DISPARITY` allowance), i.e. `data.slot == current_slot`.
  if (!chain.clock.isCurrentSlotGivenGossipDisparity(data.slot)) {
    throw new PayloadAttestationError(GossipAction.IGNORE, {
      code: PayloadAttestationErrorCode.NOT_CURRENT_SLOT,
      currentSlot: chain.clock.currentSlot,
      slot: data.slot,
    });
  }

  // [IGNORE] The `payload_attestation_message` is the first valid message
  //   received from the validator with index
  //   `payload_attestation_message.validate_index`.
  // TODO GLOAS: implement this


  // [IGNORE] The message's block `data.beacon_block_root` has been seen (via
  //   gossip or non-gossip sources) (a client MAY queue attestation for processing
  //   once the block is retrieved. Note a client might want to request payload
  //   after).
  const block = chain.forkChoice.getBlock(data.beaconBlockRoot);
  if (block === null ) {
    throw new PayloadAttestationError(GossipAction.IGNORE, {
      code: PayloadAttestationErrorCode.UNKNWON_BLOCK_ROOT,
      blockRoot: toRootHex(data.beaconBlockRoot),
    });
  }

  // [REJECT] The message's block `data.beacon_block_root` passes validation.
  // TODO GLOAS: implement this

  // [REJECT] The message's validator index is within the payload committee in
  //   `get_ptc(state, data.slot)`. The `state` is the head state corresponding to
  //   processing the block up to the current slot as determined by the fork choice.
  // TODO GLOAS: implement this

  // [REJECT] `payload_attestation_message.signature` is valid with respect to
  //   the validator's public key.
  // TODO GLOAS: implement this
}
