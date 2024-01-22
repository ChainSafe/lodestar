import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  CachedBeaconStateAltair,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getBlockRootAtSlot,
} from "@lodestar/state-transition";
import {phase0} from "@lodestar/types";

export function generateIndexedAttestations(
  state: CachedBeaconStateAltair,
  count: number
): phase0.IndexedAttestation[] {
  const result: phase0.IndexedAttestation[] = [];

  for (let epochSlot = 0; epochSlot < SLOTS_PER_EPOCH; epochSlot++) {
    const slot = state.slot - 1 - epochSlot;
    const epoch = computeEpochAtSlot(slot);
    const committeeCount = state.epochCtx.getCommitteeCountPerSlot(epoch);

    for (let committeeIndex = 0; committeeIndex < committeeCount; committeeIndex++) {
      result.push({
        attestingIndices: state.epochCtx.getBeaconCommittee(slot, committeeIndex),
        data: {
          slot: slot,
          index: committeeIndex,
          beaconBlockRoot: getBlockRootAtSlot(state, slot),
          source: {
            epoch: state.currentJustifiedCheckpoint.epoch,
            root: state.currentJustifiedCheckpoint.root,
          },
          target: {
            epoch: epoch,
            root: getBlockRootAtSlot(state, computeStartSlotAtEpoch(epoch)),
          },
        },
        signature: Buffer.alloc(96),
      });

      if (result.length >= count) return result;
    }
  }

  return result;
}

export function generateBeaconBlockHeader(state: CachedBeaconStateAltair, count: number): phase0.BeaconBlockHeader[] {
  const headers: phase0.BeaconBlockHeader[] = [];

  for (let i = 1; i <= count; i++) {
    const slot = state.slot - i;
    const epoch = computeEpochAtSlot(slot);
    const epochStartSlot = computeStartSlotAtEpoch(epoch);
    const parentRoot = getBlockRootAtSlot(state, slot - 1);
    const stateRoot = getBlockRootAtSlot(state, epochStartSlot);
    const bodyRoot = getBlockRootAtSlot(state, epochStartSlot + 1);
    const header: phase0.BeaconBlockHeader = {
      slot,
      proposerIndex: state.epochCtx.proposers[slot % SLOTS_PER_EPOCH],
      parentRoot,
      stateRoot,
      bodyRoot,
    };

    headers.push(header);
  }
  return headers;
}

export function generateSignedBeaconBlockHeader(
  state: CachedBeaconStateAltair,
  count: number
): phase0.SignedBeaconBlockHeader[] {
  const headers = generateBeaconBlockHeader(state, count);

  return headers.map((header) => ({
    message: header,
    signature: Buffer.alloc(96),
  }));
}

export function generateVoluntaryExits(state: CachedBeaconStateAltair, count: number): phase0.SignedVoluntaryExit[] {
  const result: phase0.SignedVoluntaryExit[] = [];

  for (const validatorIndex of state.epochCtx.proposers) {
    result.push({
      message: {
        epoch: state.currentJustifiedCheckpoint.epoch,
        validatorIndex,
      },
      signature: Buffer.alloc(96),
    });

    if (result.length >= count) return result;
  }

  return result;
}
