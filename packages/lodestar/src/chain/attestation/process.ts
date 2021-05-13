import {allForks} from "@chainsafe/lodestar-types";
import {CachedBeaconState, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {IAttestationJob} from "../interface";
import {AttestationError, AttestationErrorCode} from "../errors";
import {ChainEvent, ChainEventEmitter} from "../emitter";
import {IStateRegenerator} from "../regen";

/**
 * Expects valid attestation which is to be applied in forkchoice.
 *
 * Several final validations are performed in the process of converting the Attestation to an IndexedAttestation.
 */
export async function processAttestation({
  emitter,
  forkChoice,
  regen,
  job,
}: {
  emitter: ChainEventEmitter;
  forkChoice: IForkChoice;
  regen: IStateRegenerator;
  job: IAttestationJob;
}): Promise<void> {
  const {attestation} = job;
  const target = attestation.data.target;

  let targetState;
  try {
    targetState = await regen.getCheckpointState(target);
  } catch (e) {
    throw new AttestationError({
      code: AttestationErrorCode.TARGET_STATE_MISSING,
      job,
    });
  }

  let indexedAttestation;
  try {
    indexedAttestation = targetState.epochCtx.getIndexedAttestation(attestation);
  } catch (e) {
    throw new AttestationError({
      code: AttestationErrorCode.NO_COMMITTEE_FOR_SLOT_AND_INDEX,
      slot: attestation.data.slot,
      index: attestation.data.index,
      job,
    });
  }

  // Only verify signature if necessary. Most attestations come from blocks that did full signature verification
  // Otherwise, gossip validation might put it in pool before it validating signature
  if (
    !phase0.isValidIndexedAttestation(
      targetState as CachedBeaconState<allForks.BeaconState>,
      indexedAttestation,
      !job.validSignature
    )
  ) {
    throw new AttestationError({
      code: AttestationErrorCode.INVALID_SIGNATURE,
      job,
    });
  }

  forkChoice.onAttestation(indexedAttestation);
  emitter.emit(ChainEvent.attestation, attestation);
}
