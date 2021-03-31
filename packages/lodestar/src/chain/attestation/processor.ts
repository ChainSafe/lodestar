import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  IForkChoice,
  ForkChoiceError,
  ForkChoiceErrorCode,
  InvalidAttestationCode,
} from "@chainsafe/lodestar-fork-choice";

import {IAttestationJob} from "../interface";
import {IBeaconClock} from "../clock";
import {ChainEvent, ChainEventEmitter} from "../emitter";
import {IStateRegenerator} from "../regen";

import {processAttestation} from "./process";
import {AttestationError, AttestationErrorCode} from "../errors";

type AttestationProcessorModules = {
  config: IBeaconConfig;
  emitter: ChainEventEmitter;
  forkChoice: IForkChoice;
  clock: IBeaconClock;
  regen: IStateRegenerator;
};

export class AttestationProcessor {
  private modules: AttestationProcessorModules;

  constructor(modules: AttestationProcessorModules) {
    this.modules = modules;
  }

  async processAttestationJob(job: IAttestationJob): Promise<void> {
    await processAttestationJob(this.modules, job);
  }
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
export async function processAttestationJob(modules: AttestationProcessorModules, job: IAttestationJob): Promise<void> {
  try {
    // validate attestation in the forkchoice
    await processAttestation({...modules, job});
  } catch (e) {
    // above functions ForkChoice attestation error, we have to map it to AttestationError
    modules.emitter.emit(ChainEvent.errorAttestation, mapAttestationError(e, job) || e);
  }
}

/**
 * Map ForkChoice attestation error to lodestar version.
 */
function mapAttestationError(e: Error, job: IAttestationJob): AttestationError | null {
  if (e instanceof ForkChoiceError && e.type.code === ForkChoiceErrorCode.INVALID_ATTESTATION) {
    const attError = e.type.err;
    switch (attError.code) {
      case InvalidAttestationCode.EMPTY_AGGREGATION_BITFIELD:
        return new AttestationError({
          code: AttestationErrorCode.EMPTY_AGGREGATION_BITFIELD,
          job,
        });
      case InvalidAttestationCode.FUTURE_EPOCH:
        return new AttestationError({
          code: AttestationErrorCode.FUTURE_EPOCH,
          attestationEpoch: attError.attestationEpoch,
          currentEpoch: attError.currentEpoch,
          job,
        });
      case InvalidAttestationCode.PAST_EPOCH:
        return new AttestationError({
          code: AttestationErrorCode.PAST_EPOCH,
          attestationEpoch: attError.attestationEpoch,
          currentEpoch: attError.currentEpoch,
          job,
        });
      case InvalidAttestationCode.BAD_TARGET_EPOCH:
        return new AttestationError({
          code: AttestationErrorCode.BAD_TARGET_EPOCH,
          job,
        });
      case InvalidAttestationCode.UNKNOWN_TARGET_ROOT:
        return new AttestationError({
          code: AttestationErrorCode.UNKNOWN_TARGET_ROOT,
          root: attError.root,
          job,
        });
      case InvalidAttestationCode.UNKNOWN_HEAD_BLOCK:
        return new AttestationError({
          code: AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT,
          beaconBlockRoot: attError.beaconBlockRoot,
          job,
        });
      case InvalidAttestationCode.INVALID_TARGET:
        return new AttestationError({
          code: AttestationErrorCode.HEAD_NOT_TARGET_DESCENDANT,
          job,
        });
      case InvalidAttestationCode.ATTESTS_TO_FUTURE_BLOCK:
        return new AttestationError({
          code: AttestationErrorCode.ATTESTS_TO_FUTURE_BLOCK,
          block: attError.block,
          attestation: attError.attestation,
          job,
        });
      case InvalidAttestationCode.FUTURE_SLOT:
        return new AttestationError({
          code: AttestationErrorCode.FUTURE_SLOT,
          attestationSlot: attError.attestationSlot,
          latestPermissibleSlot: attError.latestPermissibleSlot,
          job,
        });
    }
  }
  return null;
}
