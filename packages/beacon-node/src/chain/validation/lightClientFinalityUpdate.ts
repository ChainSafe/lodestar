import {IChainForkConfig} from "@lodestar/config";
import {altair, ssz} from "@lodestar/types";
import {computeTimeAtSlot} from "@lodestar/state-transition";
import {IBeaconChain} from "../interface.js";
import {LightClientError, LightClientErrorCode} from "../errors/lightClientError.js";
import {GossipAction} from "../errors/index.js";
import {MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../constants/index.js";

// https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#light_client_finality_update
export function validateLightClientFinalityUpdate(
  config: IChainForkConfig,
  chain: IBeaconChain,
  gossipedFinalityUpdate: altair.LightClientFinalityUpdate
): void {
  // [IGNORE] No other finality_update with a lower or equal finalized_header.slot was already forwarded on the network
  const gossipedFinalitySlot = gossipedFinalityUpdate.finalizedHeader.slot;
  const localFinalityUpdate = chain.lightClientServer.getFinalityUpdate();
  const latestForwardedFinalitySlot = localFinalityUpdate?.finalizedHeader.slot ?? -1;

  if (gossipedFinalitySlot <= latestForwardedFinalitySlot) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.FINALITY_UPDATE_ALREADY_FORWARDED,
    });
  }

  // [IGNORE] The finality_update is received after the block at signature_slot was given enough time to propagate
  // through the network -- i.e. validate that one-third of finality_update.signature_slot has transpired
  // (SECONDS_PER_SLOT / INTERVALS_PER_SLOT seconds after the start of the slot, with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  const currentWallTime = Date.now() + MAXIMUM_GOSSIP_CLOCK_DISPARITY;
  const timeAtSignatureSlot = computeTimeAtSlot(config, gossipedFinalityUpdate.signatureSlot, chain.genesisTime) * 1000;
  if (currentWallTime < timeAtSignatureSlot + (1 / 3) * (config.SECONDS_PER_SLOT * 1000)) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.FINALITY_UPDATE_RECEIVED_TOO_EARLY,
    });
  }

  // [IGNORE] The received finality_update matches the locally computed one exactly
  if (
    localFinalityUpdate === null ||
    !ssz.altair.LightClientFinalityUpdate.equals(gossipedFinalityUpdate, localFinalityUpdate)
  ) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.FINALITY_UPDATE_NOT_MATCHING_LOCAL,
    });
  }
}
