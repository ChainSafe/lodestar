import {IBeaconConfig, IChainForkConfig} from "@chainsafe/lodestar-config";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  MAX_DEPOSITS,
  MAX_EFFECTIVE_BALANCE,
  SLOTS_PER_EPOCH,
} from "@chainsafe/lodestar-params";
import {Epoch, Root} from "@chainsafe/lodestar-types";
import {ssz} from "@chainsafe/lodestar-types";
import {Checkpoint} from "@chainsafe/lodestar-types/phase0";
import {toHexString} from "@chainsafe/ssz";
import {ZERO_HASH} from "../constants/constants.js";
import {CachedBeaconStateAllForks, BeaconStateAllForks} from "../types.js";
import {computeEpochAtSlot, getCurrentEpoch} from "./epoch.js";
import {getCurrentSlot} from "./slot.js";
import {getActiveValidatorIndices, getChurnLimit} from "./validator.js";

export const ETH_TO_GWEI = 10 ** 9;
const SAFETY_DECAY = 10;

/**
 * Returns the epoch of the latest weak subjectivity checkpoint for the given
  `state` and `safetyDecay`. The default `safetyDecay` used should be 10% (= 0.1)
 */
export function getLatestWeakSubjectivityCheckpointEpoch(
  config: IChainForkConfig,
  state: CachedBeaconStateAllForks
): Epoch {
  return state.epochCtx.currentShuffling.epoch - computeWeakSubjectivityPeriodCachedState(config, state);
}

/**
  Returns the weak subjectivity period for the current `state`.
    This computation takes into account the effect of:
      - validator set churn (bounded by `get_validator_churn_limit()` per epoch), and
      - validator balance top-ups (bounded by `MAX_DEPOSITS * SLOTS_PER_EPOCH` per epoch).
    A detailed calculation can be found at:
    https://github.com/runtimeverification/beacon-chain-verification/blob/master/weak-subjectivity/weak-subjectivity-analysis.pdf
 */
export function computeWeakSubjectivityPeriodCachedState(
  config: IChainForkConfig,
  state: CachedBeaconStateAllForks
): number {
  const activeValidatorCount = state.epochCtx.currentShuffling.activeIndices.length;
  return computeWeakSubjectivityPeriodFromConstituents(
    activeValidatorCount,
    state.epochCtx.totalActiveBalanceIncrements,
    getChurnLimit(config, activeValidatorCount),
    config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY
  );
}

/**
 * Same to computeWeakSubjectivityPeriodCachedState but for normal state
 * This is called only 1 time at app startup so it's ok to calculate totalActiveBalanceIncrements manually
 */
export function computeWeakSubjectivityPeriod(config: IChainForkConfig, state: BeaconStateAllForks): number {
  const activeIndices = getActiveValidatorIndices(state, getCurrentEpoch(state));
  const validators = state.validators.getAllReadonlyValues();
  let totalActiveBalanceIncrements = 0;
  for (const index of activeIndices) {
    totalActiveBalanceIncrements += Math.floor(validators[index].effectiveBalance / EFFECTIVE_BALANCE_INCREMENT);
  }
  if (totalActiveBalanceIncrements <= 1) {
    totalActiveBalanceIncrements = 1;
  }
  return computeWeakSubjectivityPeriodFromConstituents(
    activeIndices.length,
    totalActiveBalanceIncrements,
    getChurnLimit(config, activeIndices.length),
    config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY
  );
}

export function computeWeakSubjectivityPeriodFromConstituents(
  activeValidatorCount: number,
  totalBalanceByIncrement: number,
  churnLimit: number,
  minWithdrawabilityDelay: number
): number {
  const N = activeValidatorCount;
  // originally const t = Number(totalBalance / BigInt(N) / BigInt(ETH_TO_GWEI));
  // totalBalanceByIncrement = totalBalance / MAX_EFFECTIVE_BALANCE and MAX_EFFECTIVE_BALANCE = ETH_TO_GWEI atm
  // we need to change this calculation just in case MAX_EFFECTIVE_BALANCE != ETH_TO_GWEI
  const t = Math.floor(totalBalanceByIncrement / N);
  const T = MAX_EFFECTIVE_BALANCE / ETH_TO_GWEI;
  const delta = churnLimit;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const Delta = MAX_DEPOSITS * SLOTS_PER_EPOCH;
  const D = SAFETY_DECAY;

  let wsPeriod = minWithdrawabilityDelay;
  if (T * (200 + 3 * D) < t * (200 + 12 * D)) {
    const epochsForValidatorSetChurn = Math.floor(
      (N * (t * (200 + 12 * D) - T * (200 + 3 * D))) / (600 * delta * (2 * t + T))
    );
    const epochsForBalanceTopUps = Math.floor((N * (200 + 3 * D)) / (600 * Delta));
    wsPeriod +=
      epochsForValidatorSetChurn > epochsForBalanceTopUps ? epochsForValidatorSetChurn : epochsForBalanceTopUps;
  } else {
    wsPeriod += Math.floor((3 * N * D * t) / (200 * Delta * (T - t)));
  }
  return wsPeriod;
}

export function getLatestBlockRoot(state: BeaconStateAllForks): Root {
  const header = ssz.phase0.BeaconBlockHeader.clone(state.latestBlockHeader);
  if (ssz.Root.equals(header.stateRoot, ZERO_HASH)) {
    header.stateRoot = state.hashTreeRoot();
  }
  return ssz.phase0.BeaconBlockHeader.hashTreeRoot(header);
}

export function isWithinWeakSubjectivityPeriod(
  config: IBeaconConfig,
  wsState: BeaconStateAllForks,
  wsCheckpoint: Checkpoint
): boolean {
  const wsStateEpoch = computeEpochAtSlot(wsState.slot);
  const blockRoot = getLatestBlockRoot(wsState);
  if (!ssz.Root.equals(blockRoot, wsCheckpoint.root)) {
    throw new Error(
      `Roots do not match.  expected=${toHexString(wsCheckpoint.root)}, actual=${toHexString(blockRoot)}`
    );
  }
  if (!ssz.Epoch.equals(wsStateEpoch, wsCheckpoint.epoch)) {
    throw new Error(`Epochs do not match.  expected=${wsCheckpoint.epoch}, actual=${wsStateEpoch}`);
  }
  const wsPeriod = computeWeakSubjectivityPeriod(config, wsState);
  const clockEpoch = computeEpochAtSlot(getCurrentSlot(config, wsState.genesisTime));
  return clockEpoch <= wsStateEpoch + wsPeriod;
}
