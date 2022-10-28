import {altair, ssz} from "@lodestar/types";
import {IChainForkConfig} from "@lodestar/config";
import {computeTimeAtSlot} from "@lodestar/state-transition";
import {IBeaconChain} from "../interface.js";
import {LightClientError, LightClientErrorCode} from "../errors/lightClientError.js";
import {GossipAction} from "../errors/index.js";
import {MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../constants/index.js";

// https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#light_client_optimistic_update
export function validateLightClientOptimisticUpdate(
  config: IChainForkConfig,
  chain: IBeaconChain,
  gossipedOptimisticUpdate: altair.LightClientOptimisticUpdate
): void {
  // [IGNORE] No other optimistic_update with a lower or equal attested_header.slot was already forwarded on the network
  const gossipedAttestedSlot = gossipedOptimisticUpdate.attestedHeader.slot;
  const localOptimisticUpdate = chain.lightClientServer.getOptimisticUpdate();

  if (localOptimisticUpdate && gossipedAttestedSlot <= localOptimisticUpdate.attestedHeader.slot) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.OPTIMISTIC_UPDATE_ALREADY_FORWARDED,
    });
  }

  // [IGNORE] The optimistic_update is received after the block at signature_slot was given enough time to propagate
  // through the network -- i.e. validate that one-third of optimistic_update.signature_slot has transpired
  // (SECONDS_PER_SLOT / INTERVALS_PER_SLOT seconds after the start of the slot, with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  if (updateReceivedToEarly(config, chain.genesisTime, gossipedOptimisticUpdate)) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.OPTIMISTIC_UPDATE_RECEIVED_TOO_EARLY,
    });
  }

  // [IGNORE] The received optimistic_update matches the locally computed one exactly
  if (
    localOptimisticUpdate === null ||
    !ssz.altair.LightClientOptimisticUpdate.equals(gossipedOptimisticUpdate, localOptimisticUpdate)
  ) {
    throw new LightClientError(GossipAction.IGNORE, {
      code: LightClientErrorCode.OPTIMISTIC_UPDATE_NOT_MATCHING_LOCAL,
    });
  }
}

/**
 * [IGNORE] The *update is received after the block at signature_slot was given enough time to propagate
 * through the network -- i.e. validate that one-third of *update.signature_slot has transpired
 * (SECONDS_PER_SLOT / INTERVALS_PER_SLOT seconds after the start of the slot, with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
 */
export function updateReceivedToEarly(
  config: IChainForkConfig,
  genesisTime: number,
  update: Pick<altair.LightClientOptimisticUpdate, "signatureSlot">
): boolean {
  const signatureSlot13TimestampMs = computeTimeAtSlot(config, update.signatureSlot + 1 / 3, genesisTime) * 1000;
  const earliestAllowedTimestampMs = signatureSlot13TimestampMs + MAXIMUM_GOSSIP_CLOCK_DISPARITY;
  return Date.now() < earliestAllowedTimestampMs;
}
