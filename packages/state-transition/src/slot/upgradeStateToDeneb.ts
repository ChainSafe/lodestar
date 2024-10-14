import {ssz} from "@lodestar/types";
import {CachedBeaconStateDeneb} from "../types.js";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateCapella} from "../types.js";

/**
 * Upgrade a state from Capella to Deneb.
 */
export function upgradeStateToDeneb(stateCapella: CachedBeaconStateCapella): CachedBeaconStateDeneb {
  const {config} = stateCapella;

  const stateCapellaNode = ssz.capella.BeaconState.commitViewDU(stateCapella);
  const stateDenebView = ssz.deneb.BeaconState.getViewDU(stateCapellaNode);

  const stateDeneb = getCachedBeaconState(stateDenebView, stateCapella);

  stateDeneb.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateCapella.fork.currentVersion,
    currentVersion: config.DENEB_FORK_VERSION,
    epoch: stateCapella.epochCtx.epoch,
  });

  // Since excessBlobGas and blobGasUsed are appened in the end to latestExecutionPayloadHeader so they should
  // be set to defaults and need no assigning, but right now any access to latestExecutionPayloadHeader fails
  // with LeafNode has no left node. Weirdly its beacuse of addition of the second field as with one field
  // it seems to work.
  //
  // TODO DENEB: Debug and remove the following cloning
  stateDeneb.latestExecutionPayloadHeader = ssz.deneb.BeaconState.fields.latestExecutionPayloadHeader.toViewDU({
    ...stateCapella.latestExecutionPayloadHeader.toValue(),
    excessBlobGas: BigInt(0),
    blobGasUsed: BigInt(0),
  });

  stateDeneb.commit();
  // Clear cache to ensure the cache of capella fields is not used by new deneb fields
  // biome-ignore lint/complexity/useLiteralKeys: It is a protected attribute
  stateDeneb["clearCache"]();

  return stateDeneb;
}
