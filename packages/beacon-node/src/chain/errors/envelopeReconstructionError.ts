import {Slot} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";

export enum EnvelopeReconstructionErrorCode {
  /** The EL failed to answer engine_getPayloadBodiesByHashV2 (transport / EL down). Transient. */
  ENGINE_UNAVAILABLE = "ENVELOPE_RECONSTRUCTION_ERROR_ENGINE_UNAVAILABLE",
  /** A body returned by the EL does not hash to the root stored in the blinded envelope. Local DB/EL inconsistency. */
  BODY_ROOT_MISMATCH = "ENVELOPE_RECONSTRUCTION_ERROR_BODY_ROOT_MISMATCH",
  /** A by-range stream stopped short at a slot that cannot be served; the response so far is still valid */
  RANGE_UNSERVABLE = "ENVELOPE_RECONSTRUCTION_ERROR_RANGE_UNSERVABLE",
}

export type EnvelopeReconstructionErrorType =
  | {code: EnvelopeReconstructionErrorCode.ENGINE_UNAVAILABLE}
  | {
      code: EnvelopeReconstructionErrorCode.BODY_ROOT_MISMATCH;
      slot: Slot;
      field: "transactions" | "withdrawals" | "blockAccessList";
    }
  | {code: EnvelopeReconstructionErrorCode.RANGE_UNSERVABLE; slot: Slot};

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
