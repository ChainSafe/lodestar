import {ssz} from "@lodestar/types";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateGloas, CachedBeaconStateHeze} from "../types.js";

/**
 * Upgrade a state from Gloas to Heze.
 */
export function upgradeStateToHeze(stateGloas: CachedBeaconStateGloas): CachedBeaconStateHeze {
  const {config} = stateGloas;

  const stateGloasNode = ssz.gloas.BeaconState.commitViewDU(stateGloas);
  const stateHezeView = ssz.heze.BeaconState.getViewDU(stateGloasNode);

  const oldBid = stateGloas.latestExecutionPayloadBid;
  const newBid = ssz.heze.ExecutionPayloadBid.defaultViewDU();
  newBid.parentBlockHash = oldBid.parentBlockHash;
  newBid.parentBlockRoot = oldBid.parentBlockRoot;
  newBid.blockHash = oldBid.blockHash;
  newBid.prevRandao = oldBid.prevRandao;
  newBid.feeRecipient = oldBid.feeRecipient;
  newBid.gasLimit = oldBid.gasLimit;
  newBid.builderIndex = oldBid.builderIndex;
  newBid.slot = oldBid.slot;
  newBid.value = oldBid.value;
  newBid.executionPayment = oldBid.executionPayment;
  newBid.blobKzgCommitments = oldBid.blobKzgCommitments;
  newBid.executionRequestsRoot = oldBid.executionRequestsRoot;
  stateHezeView.latestExecutionPayloadBid = newBid;

  const stateHeze = getCachedBeaconState(stateHezeView, stateGloas);

  stateHeze.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateGloas.fork.currentVersion,
    currentVersion: config.HEZE_FORK_VERSION,
    epoch: stateGloas.epochCtx.epoch,
  });

  stateHeze.commit();
  // Clear cache to ensure the cache of gloas fields is not used by new heze fields
  // biome-ignore lint/complexity/useLiteralKeys: It is a protected attribute
  stateHeze["clearCache"]();

  return stateHeze;
}
