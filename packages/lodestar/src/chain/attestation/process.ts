import {allForks, CachedBeaconState, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {IAttestationJob} from "../interface";
import {AttestationError, AttestationErrorCode} from "../errors";
import {ChainEvent, ChainEventEmitter} from "../emitter";
import {IStateRegenerator} from "../regen";
import {IBlsVerifier} from "../bls";
import {notNullish} from "../../../../utils/lib";

/**
 * Verify attestation signatures in batch.
 * @returns jobs with valid signatures and indexed attestations.
 */
export async function verifyAttestationSignatures({
  bls,
  regen,
  jobs,
  emitter,
}: {
  bls: IBlsVerifier;
  regen: IStateRegenerator;
  jobs: IAttestationJob[];
  emitter: ChainEventEmitter;
}): Promise<IAttestationJob[]> {
  const signatureSets = await Promise.all(
    jobs.map(async (job) => {
      const attestation = job.attestation;
      let targetState;
      try {
        targetState = await regen.getCheckpointState(attestation.data.target);
        try {
          job.indexedAttestation = targetState.getIndexedAttestation(attestation);
        } catch (e) {
          emitErrorAttestation(emitter, job, AttestationErrorCode.NO_COMMITTEE_FOR_SLOT_AND_INDEX, e);
        }
      } catch (e) {
        emitErrorAttestation(emitter, job, AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE, e);
      }
      return job.indexedAttestation && targetState
        ? allForks.getIndexedAttestationSignatureSet(targetState, job.indexedAttestation)
        : null;
    })
  );
  const isAllValid = await bls.verifySignatureSets(signatureSets.filter(notNullish));
  let validJobs: IAttestationJob[];
  if (isAllValid) {
    validJobs = jobs.filter((job) => job.indexedAttestation);
  } else {
    // fallback, rarely happens
    validJobs = [];
    for (let i = 0; i < jobs.length; i++) {
      const signature = signatureSets[i];
      if (signature) {
        const valid = await bls.verifySignatureSets([signature]);
        valid
          ? validJobs.push(jobs[i])
          : emitErrorAttestation(emitter, jobs[i], AttestationErrorCode.INVALID_SIGNATURE);
      }
    }
  }
  return validJobs.map((job) => ({...job, ...{validSignature: true}}));
}

function emitErrorAttestation(
  emitter: ChainEventEmitter,
  job: IAttestationJob,
  code: AttestationErrorCode,
  error?: Error
): void {
  const data = job.attestation.data;
  switch (code) {
    case AttestationErrorCode.NO_COMMITTEE_FOR_SLOT_AND_INDEX:
      emitter.emit(
        ChainEvent.errorAttestation,
        new AttestationError({
          code: AttestationErrorCode.NO_COMMITTEE_FOR_SLOT_AND_INDEX,
          slot: data.slot,
          index: data.index,
          job,
        })
      );
      break;
    case AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE:
      if (error) {
        emitter.emit(
          ChainEvent.errorAttestation,
          new AttestationError({
            code: AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE,
            error,
            job,
          })
        );
      }
      break;
    case AttestationErrorCode.INVALID_SIGNATURE:
      emitter.emit(
        ChainEvent.errorAttestation,
        new AttestationError({
          code: AttestationErrorCode.INVALID_SIGNATURE,
          job,
        })
      );
      break;
    default:
      // should not happen
      throw new Error("Unhandle AttestationErrorCode");
  }
}

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
}): Promise<phase0.IndexedAttestation> {
  const {attestation} = job;
  const target = attestation.data.target;

  let targetState;
  try {
    targetState = await regen.getCheckpointState(target);
  } catch (e) {
    throw new AttestationError({
      code: AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE,
      error: e as Error,
      job,
    });
  }

  let indexedAttestation: phase0.IndexedAttestation;
  try {
    indexedAttestation = job.indexedAttestation || targetState.epochCtx.getIndexedAttestation(attestation);
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

  return indexedAttestation;
}
