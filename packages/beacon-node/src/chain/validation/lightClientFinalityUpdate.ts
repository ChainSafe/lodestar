import {ChainForkConfig} from "@lodestar/config";
import {LightClientFinalityUpdate} from "@lodestar/types";
import {IClock} from "../../util/clock.js";
import {GossipAction} from "../errors/index.js";
import {LightClientError, LightClientErrorCode} from "../errors/lightClientError.js";
import {updateReceivedTooEarly} from "./lightClientOptimisticUpdate.js";

// https://github.com/ethereum/consensus-specs/blob/v1.6.1/specs/altair/light-client/p2p-interface.md#light_client_finality_update
export function validateLightClientFinalityUpdate(
  config: ChainForkConfig,
  clock: IClock,
  localFinalityUpdate: LightClientFinalityUpdate | null,
  gossipedFinalityUpdate: LightClientFinalityUpdate
): void {
  // [IGNORE] No other finality_update with a lower or equal finalized_header.slot was already forwarded on the network
  const gossipedFinalitySlot = gossipedFinalityUpdate.finalizedHeader.beacon.slot;

  if (localFinalityUpdate && gossipedFinalitySlot <= localFinalityUpdate.finalizedHeader.beacon.slot) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.FINALITY_UPDATE_ALREADY_FORWARDED,
    });
  }

  // [IGNORE] The finality_update is received after the block at signature_slot was given enough time to propagate
  // through the network -- i.e. validate that `get_sync_message_due_ms(epoch)`
  // milliseconds (with a `MAXIMUM_GOSSIP_CLOCK_DISPARITY` allowance) has
  // transpired since the start of `signature_slot`.
  if (updateReceivedTooEarly(config, clock, gossipedFinalityUpdate)) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.FINALITY_UPDATE_RECEIVED_TOO_EARLY,
    });
  }

  // [IGNORE] The received finality_update matches the locally computed one exactly
  const sszType = config.getPostAltairForkTypes(
    gossipedFinalityUpdate.attestedHeader.beacon.slot
  ).LightClientFinalityUpdate;
  if (localFinalityUpdate === null || !sszType.equals(gossipedFinalityUpdate, localFinalityUpdate)) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.FINALITY_UPDATE_NOT_MATCHING_LOCAL,
    });
  }
}
