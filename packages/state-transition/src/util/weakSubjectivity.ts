import {BeaconConfig, ChainForkConfig} from "@lodestar/config";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  MAX_DEPOSITS,
  MAX_EFFECTIVE_BALANCE,
  SLOTS_PER_EPOCH,
  isForkPostElectra,
} from "@lodestar/params";
import {Epoch, Root, ssz} from "@lodestar/types";
import {Checkpoint} from "@lodestar/types/phase0";
import {toRootHex} from "@lodestar/utils";
import {ZERO_HASH} from "../constants/constants.js";
import {BeaconStateAllForks, CachedBeaconStateAllForks} from "../types.js";
import {computeCheckpointEpochAtStateSlot, computeEpochAtSlot, getCurrentEpoch} from "./epoch.js";
import {getCurrentSlot} from "./slot.js";
import {
  getActiveValidatorIndices,
  getBalanceChurnLimit,
  getBalanceChurnLimitFromCache,
  getChurnLimit,
} from "./validator.js";

export const ETH_TO_GWEI = 10 ** 9;
const SAFETY_DECAY = 10;

/**
 * Returns the epoch of the latest weak subjectivity checkpoint for the given
  `state` and `safetyDecay`. The default `safetyDecay` used should be 10% (= 0.1)
 */
export function getLatestWeakSubjectivityCheckpointEpoch(
  config: ChainForkConfig,
  state: CachedBeaconStateAllForks
): Epoch {
  return state.epochCtx.epoch - computeWeakSubjectivityPeriodCachedState(config, state);
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
  config: ChainForkConfig,
  state: CachedBeaconStateAllForks
): number {
  const activeValidatorCount = state.epochCtx.currentShuffling.activeIndices.length;
  const fork = state.config.getForkName(state.slot);

  return isForkPostElectra(fork)
    ? computeWeakSubjectivityPeriodFromConstituentsElectra(
        state.epochCtx.totalActiveBalanceIncrements,
        getBalanceChurnLimitFromCache(state.epochCtx),
        config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY
      )
    : computeWeakSubjectivityPeriodFromConstituentsPhase0(
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
export function computeWeakSubjectivityPeriod(config: ChainForkConfig, state: BeaconStateAllForks): number {
  const activeIndices = getActiveValidatorIndices(state, getCurrentEpoch(state));
  const validators = state.validators.getAllReadonlyValues();
  const fork = config.getForkName(state.slot);

  let totalActiveBalanceIncrements = 0;
  for (const index of activeIndices) {
    totalActiveBalanceIncrements += Math.floor(validators[index].effectiveBalance / EFFECTIVE_BALANCE_INCREMENT);
  }
  if (totalActiveBalanceIncrements <= 1) {
    totalActiveBalanceIncrements = 1;
  }

  return isForkPostElectra(fork)
    ? computeWeakSubjectivityPeriodFromConstituentsElectra(
        totalActiveBalanceIncrements,
        getBalanceChurnLimit(
          totalActiveBalanceIncrements,
          config.CHURN_LIMIT_QUOTIENT,
          config.MIN_PER_EPOCH_CHURN_LIMIT_ELECTRA
        ),
        config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY
      )
    : computeWeakSubjectivityPeriodFromConstituentsPhase0(
        activeIndices.length,
        totalActiveBalanceIncrements,
        getChurnLimit(config, activeIndices.length),
        config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY
      );
}

export function computeWeakSubjectivityPeriodFromConstituentsPhase0(
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

export function computeWeakSubjectivityPeriodFromConstituentsElectra(
  totalBalanceByIncrement: number,
  // Note this is not the same as churnLimit in `computeWeakSubjectivityPeriodFromConstituentsPhase0`
  balanceChurnLimit: number,
  minWithdrawabilityDelay: number
): number {
  // Keep t as increment for now. Multiply final result by EFFECTIVE_BALANCE_INCREMENT
  const t = totalBalanceByIncrement;
  const delta = balanceChurnLimit;
  const epochsForValidatorSetChurn = Math.floor(((SAFETY_DECAY * t) / (2 * delta * 100)) * EFFECTIVE_BALANCE_INCREMENT);

  return minWithdrawabilityDelay + epochsForValidatorSetChurn;
}

export function getLatestBlockRoot(state: BeaconStateAllForks): Root {
  const header = ssz.phase0.BeaconBlockHeader.clone(state.latestBlockHeader);
  if (ssz.Root.equals(header.stateRoot, ZERO_HASH)) {
    header.stateRoot = state.hashTreeRoot();
  }
  return ssz.phase0.BeaconBlockHeader.hashTreeRoot(header);
}

export function isWithinWeakSubjectivityPeriod(
  config: BeaconConfig,
  wsState: BeaconStateAllForks,
  wsCheckpoint: Checkpoint
): boolean {
  try {
    ensureWithinWeakSubjectivityPeriod(config, wsState, wsCheckpoint);
    return true;
  } catch (_) {
    return false;
  }
}

export function ensureWithinWeakSubjectivityPeriod(
  config: BeaconConfig,
  wsState: BeaconStateAllForks,
  wsCheckpoint: Checkpoint
): void {
  const wsStateEpoch = computeCheckpointEpochAtStateSlot(wsState.slot);
  const blockRoot = getLatestBlockRoot(wsState);
  if (!ssz.Root.equals(blockRoot, wsCheckpoint.root)) {
    throw new Error(`Roots do not match.  expected=${toRootHex(wsCheckpoint.root)}, actual=${toRootHex(blockRoot)}`);
  }
  if (!ssz.Epoch.equals(wsStateEpoch, wsCheckpoint.epoch)) {
    throw new Error(`Epochs do not match.  expected=${wsCheckpoint.epoch}, actual=${wsStateEpoch}`);
  }
  const wsPeriod = computeWeakSubjectivityPeriod(config, wsState);
  const clockEpoch = computeEpochAtSlot(getCurrentSlot(config, wsState.genesisTime));
  if (clockEpoch > wsStateEpoch + wsPeriod) {
    throw new Error(
      `The downloaded state with epoch ${wsStateEpoch} is not within weak subjectivity period of ${wsPeriod} from the current epoch ${clockEpoch}. Please verify your checkpoint source`
    );
  }
}
