import {LodestarError} from "@chainsafe/lodestar-utils";
import {Att} from "./interface";

export enum SurroundAttestationErrorCode {
  /**
   * The provided attestation is surrounding at least another attestation from the store
   */
  IS_SURROUNDING = "ERR_SURROUND_ATTESTATION_IS_SURROUNDING",
  /**
   * The provided attestation is surrounded by at least another attestation from the store
   */
  IS_SURROUNDED = "ERR_SURROUND_ATTESTATION_IS_SURROUNDED",
}

type SurroundAttestationErrorType =
  | {code: SurroundAttestationErrorCode.IS_SURROUNDING; att: Att; att2Target: number}
  | {code: SurroundAttestationErrorCode.IS_SURROUNDED; att: Att; att2Target: number};

export class SurroundAttestationError extends LodestarError<SurroundAttestationErrorType> {
  constructor(type: SurroundAttestationErrorType) {
    super(type);
  }
}
