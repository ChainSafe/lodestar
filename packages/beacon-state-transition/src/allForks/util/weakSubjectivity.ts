import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {MAX_DEPOSITS, MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {allForks, Epoch, Root} from "@chainsafe/lodestar-types";
import {ssz} from "@chainsafe/lodestar-types";
import {Checkpoint} from "@chainsafe/lodestar-types/phase0";
import {toHexString} from "@chainsafe/ssz";
import {CachedBeaconState} from ".";
import {
  getActiveValidatorIndices,
  getCurrentEpoch,
  computeEpochAtSlot,
  getCurrentSlot,
  ZERO_HASH,
  getTotalBalance,
  getChurnLimit,
} from "../..";
import {getWeakSubjectivityCheckpointEpoch} from "../../util/weakSubjectivity";

export const ETH_TO_GWEI = BigInt(10 ** 9);
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
export function computeWeakSubjectivityPeriod(config: IBeaconConfig, state: allForks.BeaconState): number {
  let wsPeriod = config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY;
  const ethToGwei = Number(ETH_TO_GWEI);
  const currentEpoch = getCurrentEpoch(state);
  const indices = getActiveValidatorIndices(state, currentEpoch);
  const N = indices.length;
  const totalBalance = getTotalBalance(state, indices);
  const t = Math.floor(Number(totalBalance) / N / ethToGwei);
  const T = Math.floor(Number(MAX_EFFECTIVE_BALANCE) / ethToGwei);
  const delta = getChurnLimit(config, N);
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const Delta = MAX_DEPOSITS * SLOTS_PER_EPOCH;
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
  return wsPeriod;
}

function getLatestBlockRoot(config: IBeaconConfig, state: allForks.BeaconState): Root {
  const header = ssz.phase0.BeaconBlockHeader.clone(state.latestBlockHeader);
  if (ssz.Root.equals(header.stateRoot, ZERO_HASH)) {
    header.stateRoot = config.getForkTypes(state.slot).BeaconState.hashTreeRoot(state);
  }
  return ssz.phase0.BeaconBlockHeader.hashTreeRoot(header);
}

export function isWithinWeakSubjectivityPeriod(
  config: IBeaconConfig,
  genesisTime: number,
  wsState: allForks.BeaconState,
  wsCheckpoint?: Checkpoint
): boolean {
  const wsStateEpoch = computeEpochAtSlot(wsState.slot);
  const blockRoot = getLatestBlockRoot(config, wsState);
  if (wsCheckpoint) {
    if (!ssz.Root.equals(blockRoot, wsCheckpoint.root)) {
      throw new Error(
        `Roots do not match.  expected=${toHexString(wsCheckpoint.root)}, actual=${toHexString(blockRoot)}`
      );
    }
    if (!ssz.Epoch.equals(wsStateEpoch, wsCheckpoint.epoch)) {
      throw new Error(`Epochs do not match.  expected=${wsCheckpoint.epoch}, actual=${wsStateEpoch}`);
    }
  }
  const wsPeriod = computeWeakSubjectivityPeriod(config, wsState);
  const currentEpoch = computeEpochAtSlot(getCurrentSlot(config, genesisTime));
  return currentEpoch <= wsStateEpoch + wsPeriod;
}
