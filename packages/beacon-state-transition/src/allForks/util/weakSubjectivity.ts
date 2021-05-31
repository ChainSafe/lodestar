import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, Epoch, Uint64} from "@chainsafe/lodestar-types";
import {Checkpoint} from "@chainsafe/lodestar-types/phase0";
import {assert} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {CachedBeaconState} from ".";
import {
  getActiveValidatorIndices,
  getCurrentEpoch,
  getTotalActiveBalance,
  computeEpochAtSlot,
  getCurrentSlot,
  getValidatorChurnLimit,
} from "../..";
import {getWeakSubjectivityCheckpointEpoch} from "../../util/weakSubjectivity";

const ETH_TO_GWEI = BigInt(10 ** 9);
const SAFETY_DECAY = BigInt(10);

/**
 * Returns the epoch of the latest weak subjectivity checkpoint for the given
  `state` and `safetyDecay`. The default `safetyDecay` used should be 10% (= 0.1)
 */
export function getLatestWeakSubjectivityCheckpointEpoch(
  config: IBeaconConfig,
  state: CachedBeaconState<allForks.BeaconState>,
  safetyDecay = 0.1
): Epoch {
  const valCount = state.epochCtx.currentShuffling.activeIndices.length;
  return getWeakSubjectivityCheckpointEpoch(config, state.finalizedCheckpoint.epoch, valCount, safetyDecay);
}

/**
  Returns the weak subjectivity period for the current ``state``. 
    This computation takes into account the effect of:
      - validator set churn (bounded by ``get_validator_churn_limit()`` per epoch), and 
      - validator balance top-ups (bounded by ``MAX_DEPOSITS * SLOTS_PER_EPOCH`` per epoch).
    A detailed calculation can be found at:
    https://github.com/runtimeverification/beacon-chain-verification/blob/master/weak-subjectivity/weak-subjectivity-analysis.pdf
 */
export function computeWeakSubjectivityPeriod(config: IBeaconConfig, state: allForks.BeaconState): Uint64 {
  let wsPeriod = config.params.MIN_VALIDATOR_WITHDRAWABILITY_DELAY;
  const N = getActiveValidatorIndices(state, getCurrentEpoch(config, state)).length;
  const t = Math.floor(Number(getTotalActiveBalance(config, state)) / N / Number(ETH_TO_GWEI));
  const T = Math.floor(Number(config.params.MAX_EFFECTIVE_BALANCE) / Number(ETH_TO_GWEI));
  const delta = getValidatorChurnLimit(config, state);
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const Delta = config.params.MAX_DEPOSITS * config.params.SLOTS_PER_EPOCH;
  const D = Number(SAFETY_DECAY);

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
  return BigInt(wsPeriod);
}

export function isWithinWeakSubjectivityPeriod(
  config: IBeaconConfig,
  genesisTime: number,
  wsState: allForks.BeaconState,
  wsCheckpoint: Checkpoint
): boolean {
  // Clients may choose to validate the input state against the input Weak Subjectivity Checkpoint
  assert.equal(toHexString(wsState.latestBlockHeader.stateRoot), toHexString(wsCheckpoint.root));
  assert.equal(computeEpochAtSlot(config, wsState.slot), wsCheckpoint.epoch);

  const wsPeriod = computeWeakSubjectivityPeriod(config, wsState);
  const wsStateEpoch = computeEpochAtSlot(config, wsState.slot);
  const currentEpoch = computeEpochAtSlot(config, getCurrentSlot(config, genesisTime));
  return currentEpoch <= BigInt(wsStateEpoch) + wsPeriod;
}
