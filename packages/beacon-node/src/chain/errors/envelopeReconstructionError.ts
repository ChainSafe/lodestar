import {Slot} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";

export enum EnvelopeReconstructionErrorCode {
  /** The EL failed to answer engine_getPayloadBodiesByHash (transport / EL down). Transient. */
  ENGINE_UNAVAILABLE = "ENVELOPE_RECONSTRUCTION_ERROR_ENGINE_UNAVAILABLE",
  /** EL-served transactions do not hash to the archived transactionsRoot. Local DB/EL inconsistency. */
  TRANSACTIONS_ROOT_MISMATCH = "ENVELOPE_RECONSTRUCTION_ERROR_TRANSACTIONS_ROOT_MISMATCH",
  /** EL-served withdrawals do not hash to the archived withdrawalsRoot. Local DB/EL inconsistency. */
  WITHDRAWALS_ROOT_MISMATCH = "ENVELOPE_RECONSTRUCTION_ERROR_WITHDRAWALS_ROOT_MISMATCH",
}

export type EnvelopeReconstructionErrorType =
  | {code: EnvelopeReconstructionErrorCode.ENGINE_UNAVAILABLE}
  | {code: EnvelopeReconstructionErrorCode.TRANSACTIONS_ROOT_MISMATCH; slot: Slot}
  | {code: EnvelopeReconstructionErrorCode.WITHDRAWALS_ROOT_MISMATCH; slot: Slot};

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
