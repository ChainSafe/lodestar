import {IChainForkConfig} from "@lodestar/config";
import {altair} from "@lodestar/types";
import {computeTimeAtSlot} from "@lodestar/state-transition";
import {IBeaconChain} from "../interface.js";
import {LightClientError, LightClientErrorCode} from "../errors/lightClientError.js";
import {GossipAction} from "../errors/index.js";

// https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#light_client_finality_update
export async function validateLightClientFinalityUpdate(
  config: IChainForkConfig,
  chain: IBeaconChain,
  lightClientFinalityUpdate: altair.LightClientFinalityUpdate
): Promise<void> {
  // [IGNORE] No other finality_update with a lower or equal finalized_header.slot was already forwarded on the network
  const gossipedFinalitySlot = lightClientFinalityUpdate.finalizedHeader.slot;
  const latestForwardedFinalitySlot = chain.lightClientServer.latestForwardedFinalitySlot;
  if (latestForwardedFinalitySlot != null && gossipedFinalitySlot <= latestForwardedFinalitySlot) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.FINALITY_UPDATE_ALREADY_FORWARDED,
    });
  }

  // [IGNORE] The finality_update is received after the block at signature_slot was given enough time to propagate
  // through the network -- i.e. validate that one-third of finality_update.signature_slot has transpired
  // (SECONDS_PER_SLOT / INTERVALS_PER_SLOT seconds after the start of the slot, with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  const signatureSlot = lightClientFinalityUpdate.signatureSlot;
  const timeAtSignatureSlot = computeTimeAtSlot(config, signatureSlot, chain.genesisTime);
  const currentSlotWithGossipDisparity = chain.clock.currentSlotWithGossipDisparity;
  if (currentSlotWithGossipDisparity < timeAtSignatureSlot) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.FINALITY_UPDATE_RECEIVED_TOO_EARLY,
    });
  }

  // [IGNORE] The received finality_update matches the locally computed one exactly
  if (lightClientFinalityUpdate != chain.lightClientServer.getFinalityUpdate()) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.FINALITY_UPDATE_NOT_MATCHING_LOCAL,
    });
  }

  chain.lightClientServer.latestForwardedFinalitySlot = lightClientFinalityUpdate.finalizedHeader.slot;
}
