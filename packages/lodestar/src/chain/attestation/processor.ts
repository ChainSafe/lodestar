import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {
  IForkChoice,
  ForkChoiceError,
  ForkChoiceErrorCode,
  InvalidAttestationCode,
  InvalidAttestation,
} from "@chainsafe/lodestar-fork-choice";

import {IAttestationJob} from "../interface";
import {IBeaconClock} from "../clock";
import {ChainEvent, ChainEventEmitter} from "../emitter";
import {IStateRegenerator} from "../regen";

import {processAttestation, verifyAttestationSignatures} from "./process";
import {AttestationError, AttestationErrorCode, AttestationErrorType} from "../errors";
import {IBlsVerifier} from "../bls";

type AttestationProcessorModules = {
  config: IBeaconConfig;
  emitter: ChainEventEmitter;
  forkChoice: IForkChoice;
  clock: IBeaconClock;
  bls: IBlsVerifier;
  regen: IStateRegenerator;
};

export class AttestationProcessor {
  private modules: AttestationProcessorModules;
  private pendingAttestationJobs: IAttestationJob[] = [];

  constructor(modules: AttestationProcessorModules) {
    this.modules = modules;
  }

  async processAttestationJob(job: IAttestationJob): Promise<phase0.IndexedAttestation | null> {
    return await processAttestationJob(this.modules, job);
  }

  /**
   * Same to processAttestationJob but we process jobs in batch.
   */
  processAttestationJobInBatch(job: IAttestationJob): void {
    if (job.validSignature) {
      void processAttestationJob(this.modules, job);
    } else {
      this.pendingAttestationJobs.push(job);
      const toProcessAttestations = needProcessPendingAttestations(this.pendingAttestationJobs);
      if (toProcessAttestations) {
        void processAttestationJobsInBatch(this.modules, toProcessAttestations);
      }
    }
  }
}

/**
 * Check if it's enough 128 jobs to process.
 * Return jobs to process or undefined.
 */
export function needProcessPendingAttestations(
  pendingAttestationJobs: IAttestationJob[],
  itemsPerBatch = 128
): IAttestationJob[] | null {
  if (pendingAttestationJobs.length >= itemsPerBatch) {
    return pendingAttestationJobs.splice(0, itemsPerBatch);
  } else {
    return null;
  }
}

/**
 * Verify signatures in batch then process each job separately.
 */
export async function processAttestationJobsInBatch(
  modules: AttestationProcessorModules,
  jobs: IAttestationJob[]
): Promise<void> {
  const verifiedJobs = await verifyAttestationSignatures({...modules, jobs});
  await Promise.all(verifiedJobs.map((job) => processAttestationJob(modules, job)));
}

/**
 * Validate and process an attestation
 *
 * The only effects of running this are:
 * - forkChoice update, in the case of a valid attestation
 * - various events emitted: attestation, error:attestation
 * - (state cache update, from state regeneration)
 *
 * All other effects are provided by downstream event handlers
 */
export async function processAttestationJob(
  modules: AttestationProcessorModules,
  job: IAttestationJob
): Promise<phase0.IndexedAttestation | null> {
  try {
    // validate attestation in the forkchoice
    return await processAttestation({...modules, job});
  } catch (e) {
    // above functions ForkChoice attestation error, we have to map it to AttestationError
    modules.emitter.emit(ChainEvent.errorAttestation, mapAttestationError(e, job) || e);
    return null;
  }
}

/**
 * Map ForkChoice attestation error to lodestar version.
 * Return null if the error is not an attestation error.
 */
export function mapAttestationError(e: Error, job: IAttestationJob): AttestationError | null {
  if (e instanceof ForkChoiceError && e.type.code === ForkChoiceErrorCode.INVALID_ATTESTATION) {
    const attError = ((e as ForkChoiceError).type as {err: InvalidAttestation}).err as InvalidAttestation;
    // Map InvalidAttestationCode of forkchoice to lodestar AttestationErrorCode, other properties are the same
    const codeName = Object.keys(InvalidAttestationCode).find(
      (key) => InvalidAttestationCode[key as keyof typeof InvalidAttestationCode] === attError.code
    );
    const code = AttestationErrorCode[codeName as keyof typeof AttestationErrorCode];
    const errType = {...attError, code} as AttestationErrorType;
    const lodestarErr = new AttestationError({job, ...errType});
    lodestarErr.stack = e.stack;
    return lodestarErr;
  } else if (e instanceof AttestationError) {
    return e;
  }
  return null;
}
