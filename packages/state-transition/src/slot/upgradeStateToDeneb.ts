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
    currentVersion: config.EIP4844_FORK_VERSION,
    epoch: stateCapella.epochCtx.epoch,
  });

  // The field order of deneb latestExecutionPayloadHeader is not the same to capella
  // all fields after excessDataGas need to explicitly set
  stateDeneb.latestExecutionPayloadHeader.excessDataGas = ssz.UintBn256.defaultValue();
  stateDeneb.latestExecutionPayloadHeader.blockHash = stateCapella.latestExecutionPayloadHeader.blockHash;
  stateDeneb.latestExecutionPayloadHeader.transactionsRoot = stateCapella.latestExecutionPayloadHeader.transactionsRoot;
  stateDeneb.latestExecutionPayloadHeader.withdrawalsRoot = stateCapella.latestExecutionPayloadHeader.withdrawalsRoot;

  stateDeneb.commit();

  return stateDeneb;
}
