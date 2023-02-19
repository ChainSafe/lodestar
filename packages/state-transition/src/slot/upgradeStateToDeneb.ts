import {ssz} from "@lodestar/types";
import {CachedBeaconStateDeneb} from "../types.js";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateVerkle} from "../types.js";

/**
 * Upgrade a state from Verkle to Deneb.
 */
export function upgradeStateToDeneb(stateVerkle: CachedBeaconStateVerkle): CachedBeaconStateDeneb {
  const {config} = stateVerkle;

  const stateVerkleNode = ssz.verkle.BeaconState.commitViewDU(stateVerkle);
  const stateDenebView = ssz.deneb.BeaconState.getViewDU(stateVerkleNode);

  const stateDeneb = getCachedBeaconState(stateDenebView, stateVerkle);

  stateDeneb.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateVerkle.fork.currentVersion,
    currentVersion: config.DENEB_FORK_VERSION,
    epoch: stateVerkle.epochCtx.epoch,
  });

  // Since excessBlobGas and blobGasUsed are appened in the end to latestExecutionPayloadHeader so they should
  // be set to defaults and need no assigning, but right now any access to latestExecutionPayloadHeader fails
  // with LeafNode has no left node. Weirdly its beacuse of addition of the second field as with one field
  // it seems to work.
  //
  // TODO DENEB: Debug and remove the following cloning
  stateDeneb.latestExecutionPayloadHeader = ssz.deneb.BeaconState.fields.latestExecutionPayloadHeader.toViewDU({
    ...stateVerkle.latestExecutionPayloadHeader.toValue(),
    excessBlobGas: BigInt(0),
    blobGasUsed: BigInt(0),
  });

  stateDeneb.commit();
  // Clear cache to ensure the cache of verkle fields is not used by new deneb fields
  stateDeneb["clearCache"]();

  return stateDeneb;
}
