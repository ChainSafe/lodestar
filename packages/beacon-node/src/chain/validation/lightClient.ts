import {altair} from "@lodestar/types";
import {IBeaconChain} from "../interface.js";

export async function validateLightClientFinalityUpdate(
  _chain: IBeaconChain,
  _lightClientFinalityUpdate: altair.LightClientFinalityUpdate
): Promise<void> {
  // [IGNORE] No other finality_update with a lower or equal finalized_header.slot was already forwarded on the network
  // [IGNORE] The finality_update is received after the block at signature_slot was given enough time to propagate
  // through the network -- i.e. validate that one-third of finality_update.signature_slot has transpired
  // (SECONDS_PER_SLOT / INTERVALS_PER_SLOT seconds after the start of the slot, with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  // [IGNORE] The received finality_update matches the locally computed one exactly
  return Promise.resolve();
}

export async function validateLightClientOptimisticUpdate(
  _chain: IBeaconChain,
  _lightClientOptimisticUpdate: altair.LightClientOptimisticUpdate
): Promise<void> {
  // [IGNORE] No other optimistic_update with a lower or equal attested_header.slot was already forwarded on the network
  // [IGNORE] The optimistic_update is received after the block at signature_slot was given enough time to propagate through the network -- i.e. validate that one-third of optimistic_update.signature_slot has transpired (SECONDS_PER_SLOT / INTERVALS_PER_SLOT seconds after the start of the slot, with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  // [IGNORE] The received optimistic_update matches the locally computed one exactly
  return Promise.resolve();
}
