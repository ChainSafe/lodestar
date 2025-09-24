import {ChainForkConfig} from "@lodestar/config";
import {LightClientOptimisticUpdate} from "@lodestar/types";
import {MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../constants/index.js";
import {assertLightClientServer} from "../../node/utils/lightclient.js";
import {IClock} from "../../util/clock.js";
import {GossipAction} from "../errors/index.js";
import {LightClientError, LightClientErrorCode} from "../errors/lightClientError.js";
import {IBeaconChain} from "../interface.js";

// https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#light_client_optimistic_update
export function validateLightClientOptimisticUpdate(
  config: ChainForkConfig,
  chain: IBeaconChain,
  gossipedOptimisticUpdate: LightClientOptimisticUpdate
): void {
  assertLightClientServer(chain.lightClientServer);

  // [IGNORE] No other optimistic_update with a lower or equal attested_header.slot was already forwarded on the network
  const gossipedAttestedSlot = gossipedOptimisticUpdate.attestedHeader.beacon.slot;
  const localOptimisticUpdate = chain.lightClientServer.getOptimisticUpdate();

  if (localOptimisticUpdate && gossipedAttestedSlot <= localOptimisticUpdate.attestedHeader.beacon.slot) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.OPTIMISTIC_UPDATE_ALREADY_FORWARDED,
    });
  }

  // [IGNORE] The optimistic_update is received after the block at signature_slot was given enough time to propagate
  // through the network -- i.e. validate that `get_sync_message_due_ms(epoch)`
  // milliseconds (with a `MAXIMUM_GOSSIP_CLOCK_DISPARITY` allowance) has
  // transpired since the start of `signature_slot`.
  if (updateReceivedTooEarly(config, chain.clock, gossipedOptimisticUpdate)) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.OPTIMISTIC_UPDATE_RECEIVED_TOO_EARLY,
    });
  }

  // [IGNORE] The received optimistic_update matches the locally computed one exactly
  const sszType = config.getPostAltairForkTypes(
    gossipedOptimisticUpdate.attestedHeader.beacon.slot
  ).LightClientOptimisticUpdate;
  if (localOptimisticUpdate === null || !sszType.equals(gossipedOptimisticUpdate, localOptimisticUpdate)) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.OPTIMISTIC_UPDATE_NOT_MATCHING_LOCAL,
    });
  }
}

/**
 * Returns true, if the spec condition below triggers an IGNORE.
 *
 *      Sig + SYNC_MESSAGE_DUE_BPS time
 * -----|-----
 * xxx|-------  (x is not okay)
 *
 * [IGNORE] The *update is received after the block at signature_slot was given enough time to propagate
 * through the network -- i.e. validate that `get_sync_message_due_ms(epoch)`
 * milliseconds (with a `MAXIMUM_GOSSIP_CLOCK_DISPARITY` allowance) has
 * transpired since the start of `signature_slot`.
 */
export function updateReceivedTooEarly(
  config: ChainForkConfig,
  clock: IClock,
  update: Pick<LightClientOptimisticUpdate, "signatureSlot">
): boolean {
  const fork = config.getForkName(update.signatureSlot);
  return clock.msFromSlot(update.signatureSlot) < config.getSyncMessageDueMs(fork) - MAXIMUM_GOSSIP_CLOCK_DISPARITY;
}
