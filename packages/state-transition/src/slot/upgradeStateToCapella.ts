import {ssz} from "@lodestar/types";

import {CachedBeaconStateCapella} from "../types.js";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateBellatrix} from "../types.js";

/**
 * Upgrade a state from Bellatrix to Capella.
 */
export function upgradeStateToCapella(stateBellatrix: CachedBeaconStateBellatrix): CachedBeaconStateCapella {
  const {config} = stateBellatrix;

  const stateBellatrixNode = ssz.bellatrix.BeaconState.commitViewDU(stateBellatrix);
  const stateCapellaView = ssz.capella.BeaconState.getViewDU(stateBellatrixNode);

  const stateCapella = getCachedBeaconState(stateCapellaView, stateBellatrix);

  stateCapella.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateBellatrix.fork.currentVersion,
    currentVersion: config.CAPELLA_FORK_VERSION,
    epoch: stateBellatrix.epochCtx.epoch,
  });

  const {
    parentHash,
    feeRecipient,
    stateRoot,
    receiptsRoot,
    logsBloom,
    prevRandao,
    blockNumber,
    gasLimit,
    gasUsed,
    timestamp,
    extraData,
    baseFeePerGas,
    blockHash,
    transactionsRoot,
  } = stateBellatrix.latestExecutionPayloadHeader;

  stateCapella.latestExecutionPayloadHeader = ssz.capella.ExecutionPayloadHeader.toViewDU({
    parentHash,
    feeRecipient,
    stateRoot,
    receiptsRoot,
    logsBloom,
    prevRandao,
    blockNumber,
    gasLimit,
    gasUsed,
    timestamp,
    extraData,
    baseFeePerGas,
    blockHash,
    transactionsRoot,
    withdrawalsRoot: ssz.Root.defaultValue(),
  });

  stateCapella.commit();

  return stateCapella;
}
