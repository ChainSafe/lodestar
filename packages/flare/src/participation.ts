import {altair, phase0, ssz} from "@lodestar/types";
import {IChainConfig} from "@lodestar/config";
import {
  RootCache,
  EpochContext,
  BeaconStateAllForks,
  createEmptyEpochContextImmutableData,
  getAttestationParticipationStatus,
} from "@lodestar/state-transition";
import {ForkName, TIMELY_HEAD_FLAG_INDEX, TIMELY_SOURCE_FLAG_INDEX, TIMELY_TARGET_FLAG_INDEX} from "@lodestar/params";
import {downloadHeadState} from "./downloadHeadState.js";

/* eslint-disable no-console */

const {state, config, fork} = await downloadHeadState();

const TIMELY_SOURCE = 1 << TIMELY_SOURCE_FLAG_INDEX;
const TIMELY_TARGET = 1 << TIMELY_TARGET_FLAG_INDEX;
const TIMELY_HEAD = 1 << TIMELY_HEAD_FLAG_INDEX;

const sourceByK = new Map<number, number>();
const targetByK = new Map<number, number>();
const headByK = new Map<number, number>();

const previousEpochParticipation =
  fork === ForkName.phase0
    ? translateParticipation(
        ssz.phase0.BeaconState.toViewDU(state as phase0.BeaconState),
        config,
        (state as phase0.BeaconState).previousEpochAttestations
      )
    : (state as altair.BeaconState).previousEpochParticipation;

const validatorCount = previousEpochParticipation.length;

for (let i = 0; i < validatorCount; i++) {
  const flags = previousEpochParticipation[i];
  const {source, target, head} = parseParticipation(flags);

  const k = i - (i % 1000);

  if (source) sourceByK.set(k, (sourceByK.get(k) ?? 0) + 1);
  if (target) targetByK.set(k, (targetByK.get(k) ?? 0) + 1);
  if (head) headByK.set(k, (headByK.get(k) ?? 0) + 1);

  // console.log(String(i).padStart(6), flags.toString(2).padStart(3, "0"));
}

console.log("indexes   sorc targ head");

for (let k = 0; k < validatorCount; k += 1000) {
  const values = [sourceByK.get(k) ?? 0, targetByK.get(k) ?? 0, headByK.get(k) ?? 0]
    .map((val) => val.toString(10).padStart(4))
    .join(" ");

  console.log(k.toString(10).padEnd(6), "=>", values);
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function parseParticipation(flag: number) {
  return {
    source: (flag & TIMELY_SOURCE) === TIMELY_SOURCE,
    target: (flag & TIMELY_TARGET) === TIMELY_TARGET,
    head: (flag & TIMELY_HEAD) === TIMELY_HEAD,
  };
}

/**
 * Translate_participation in https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/altair/fork.md
 */
export function translateParticipation(
  state: BeaconStateAllForks,
  config: IChainConfig,
  pendingAttesations: phase0.PendingAttestation[]
): number[] {
  const epochCtx = EpochContext.createFromState(state, createEmptyEpochContextImmutableData(config, state), {
    skipSyncCommitteeCache: true,
    skipSyncPubkeys: true,
  });

  const rootCache = new RootCache(state);
  const previousEpochParticipation = new Array<number>(state.validators.length);

  for (const attestation of pendingAttesations) {
    const data = attestation.data;
    const attestationFlags = getAttestationParticipationStatus(
      data,
      attestation.inclusionDelay,
      epochCtx.epoch,
      rootCache
    );

    const committeeIndices = epochCtx.getBeaconCommittee(data.slot, data.index);
    const attestingIndices = attestation.aggregationBits.intersectValues(committeeIndices);

    for (const index of attestingIndices) {
      // ParticipationFlags type uses option {setBitwiseOR: true}, .set() does a |= operation
      previousEpochParticipation[index] = (previousEpochParticipation[index] ?? 0) | attestationFlags;
    }
  }

  return previousEpochParticipation;
}
