import {ChainForkConfig} from "@lodestar/config";
import {allForks} from "@lodestar/types";
import {IBeaconChain} from "../interface.js";
import {LightClientError, LightClientErrorCode} from "../errors/lightClientError.js";
import {GossipAction} from "../errors/index.js";
import {updateReceivedTooEarly} from "./lightClientOptimisticUpdate.js";

// https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#light_client_finality_update
export function validateLightClientFinalityUpdate(
  config: ChainForkConfig,
  chain: IBeaconChain,
  gossipedFinalityUpdate: allForks.LightClientFinalityUpdate
): void {
  // [IGNORE] No other finality_update with a lower or equal finalized_header.slot was already forwarded on the network
  const gossipedFinalitySlot = gossipedFinalityUpdate.finalizedHeader.beacon.slot;
  const localFinalityUpdate = chain.lightClientServer.getFinalityUpdate();

  if (localFinalityUpdate && gossipedFinalitySlot <= localFinalityUpdate.finalizedHeader.beacon.slot) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.FINALITY_UPDATE_ALREADY_FORWARDED,
    });
  }

  // [IGNORE] The finality_update is received after the block at signature_slot was given enough time to propagate
  // through the network -- i.e. validate that one-third of finality_update.signature_slot has transpired
  // (SECONDS_PER_SLOT / INTERVALS_PER_SLOT seconds after the start of the slot, with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  if (updateReceivedTooEarly(config, chain.genesisTime, gossipedFinalityUpdate)) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.FINALITY_UPDATE_RECEIVED_TOO_EARLY,
    });
  }

  // [IGNORE] The received finality_update matches the locally computed one exactly
  const sszType = config.getLightClientForkTypes(gossipedFinalityUpdate.attestedHeader.beacon.slot)[
    "LightClientFinalityUpdate"
  ];
  if (localFinalityUpdate === null || !sszType.equals(gossipedFinalityUpdate, localFinalityUpdate)) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.FINALITY_UPDATE_NOT_MATCHING_LOCAL,
    });
  }
}
