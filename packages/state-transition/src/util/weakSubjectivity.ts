import {ChainForkConfig} from "@lodestar/config";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  ForkSeq,
  GENESIS_SLOT,
  MAX_DEPOSITS,
  MAX_EFFECTIVE_BALANCE,
  SLOTS_PER_EPOCH,
  isForkPostElectra,
  isForkPostGloas,
} from "@lodestar/params";
import {Epoch, Root, Slot, TimeSeconds, ssz} from "@lodestar/types";
import {ZERO_HASH} from "../constants/constants.js";
import {BeaconStateAllForks, CachedBeaconStateAllForks} from "../types.js";
import {computeCheckpointEpochAtStateSlot, computeEpochAtSlot, getCurrentEpoch} from "./epoch.js";
import {StateBytesMetadata, getStateTypeFromBytes, scanActiveValidatorsFromStateBytes} from "./sszBytes.js";
import {
  getActivationChurnLimit,
  getActiveValidatorIndices,
  getBalanceChurnLimit,
  getBalanceChurnLimitFromCache,
  getChurnLimit,
  getConsolidationChurnLimit,
  getExitChurnLimit,
  getGloasChurnLimits,
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
  const fork = config.getForkName(state.slot);

  return isForkPostGloas(fork)
    ? computeWeakSubjectivityPeriodFromConstituentsGloas(
        state.epochCtx.totalActiveBalanceIncrements,
        getExitChurnLimit(state.epochCtx),
        getActivationChurnLimit(state.epochCtx),
        getConsolidationChurnLimit(ForkSeq.gloas, state.epochCtx),
        config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY
      )
    : isForkPostElectra(fork)
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
 */
export function computeWeakSubjectivityPeriod(config: ChainForkConfig, state: BeaconStateAllForks): number {
  const activeIndices = getActiveValidatorIndices(state, getCurrentEpoch(state));
  const validators = state.validators.getAllReadonlyValues();

  let totalActiveBalanceIncrements = 0;
  for (const index of activeIndices) {
    totalActiveBalanceIncrements += Math.floor(validators[index].effectiveBalance / EFFECTIVE_BALANCE_INCREMENT);
  }
  if (totalActiveBalanceIncrements <= 1) {
    totalActiveBalanceIncrements = 1;
  }

  return computeWeakSubjectivityPeriodFromActiveValidators(config, state.slot, {
    activeValidatorCount: activeIndices.length,
    totalActiveBalanceIncrements,
  });
}

function computeWeakSubjectivityPeriodFromActiveValidators(
  config: ChainForkConfig,
  slot: Slot,
  {
    activeValidatorCount,
    totalActiveBalanceIncrements,
  }: {activeValidatorCount: number; totalActiveBalanceIncrements: number}
): number {
  const fork = config.getForkName(slot);

  const churnLimitsGloas = getGloasChurnLimits(config, totalActiveBalanceIncrements);

  return isForkPostGloas(fork)
    ? computeWeakSubjectivityPeriodFromConstituentsGloas(
        totalActiveBalanceIncrements,
        churnLimitsGloas.exit,
        churnLimitsGloas.activation,
        churnLimitsGloas.consolidation,
        config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY
      )
    : isForkPostElectra(fork)
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
          activeValidatorCount,
          totalActiveBalanceIncrements,
          getChurnLimit(config, activeValidatorCount),
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

export function computeWeakSubjectivityPeriodFromConstituentsGloas(
  totalBalanceByIncrement: number,
  exitChurnLimit: number,
  activationChurnLimit: number,
  consolidationChurnLimit: number,
  minWithdrawabilityDelay: number
): number {
  // Keep t as increment for now. Multiply final result by EFFECTIVE_BALANCE_INCREMENT
  const t = totalBalanceByIncrement;
  const delta = Math.floor((2 * exitChurnLimit) / 3) + Math.floor(activationChurnLimit / 3) + consolidationChurnLimit;
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

export type WeakSubjectivitySummary = {checkpointEpoch: Epoch; genesisTime: number; period: number};

/** The metadata must describe the supplied state bytes. */
export function computeWeakSubjectivitySummaryFromStateBytes(
  config: ChainForkConfig,
  bytes: Uint8Array,
  metadata: StateBytesMetadata
): WeakSubjectivitySummary {
  const {slot, genesisTime} = metadata;
  const stateType = getStateTypeFromBytes(config, bytes);
  const {activeValidatorCount, totalActiveBalanceIncrements} = scanActiveValidatorsFromStateBytes(
    bytes,
    stateType,
    computeEpochAtSlot(slot)
  );
  const period = computeWeakSubjectivityPeriodFromActiveValidators(config, slot, {
    activeValidatorCount,
    totalActiveBalanceIncrements,
  });
  return {checkpointEpoch: computeCheckpointEpochAtStateSlot(slot), genesisTime, period};
}

export function isWithinWeakSubjectivityPeriodFromSummary(
  config: ChainForkConfig,
  summary: WeakSubjectivitySummary,
  now: TimeSeconds = Date.now() / 1000
): boolean {
  const clockSlot = GENESIS_SLOT + Math.floor((now - summary.genesisTime) / (config.SLOT_DURATION_MS / 1000));
  return computeEpochAtSlot(clockSlot) <= summary.checkpointEpoch + summary.period;
}
