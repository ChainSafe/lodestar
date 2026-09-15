import {Slot} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";

export enum EnvelopeReconstructionErrorCode {
  /** The EL failed to answer engine_getPayloadBodiesByHashV2 (transport / EL down). Transient. */
  ENGINE_UNAVAILABLE = "ENVELOPE_RECONSTRUCTION_ERROR_ENGINE_UNAVAILABLE",
  /** The payload rebuilt from EL bodies does not hash to the archived payloadRoot. Local DB/EL inconsistency. */
  PAYLOAD_ROOT_MISMATCH = "ENVELOPE_RECONSTRUCTION_ERROR_PAYLOAD_ROOT_MISMATCH",
}

export type EnvelopeReconstructionErrorType =
  | {code: EnvelopeReconstructionErrorCode.ENGINE_UNAVAILABLE}
  | {code: EnvelopeReconstructionErrorCode.PAYLOAD_ROOT_MISMATCH; slot: Slot};

export class EnvelopeReconstructionError extends LodestarError<EnvelopeReconstructionErrorType> {
  constructor(type: EnvelopeReconstructionErrorType, message?: string, options?: {cause?: unknown}) {
    super(type, message);
    if (options?.cause !== undefined) this.cause = options.cause;
  }

  /** Transient EL outage vs. a real local inconsistency. Callers map this to their transport's error status. */
  isTransient(): boolean {
    return this.type.code === EnvelopeReconstructionErrorCode.ENGINE_UNAVAILABLE;
  }
}
