import {RootHex, Slot} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";

export enum PayloadReconstructionErrorCode {
  BODY_UNAVAILABLE = "PAYLOAD_RECONSTRUCTION_BODY_UNAVAILABLE",
  PAYLOAD_ROOT_MISMATCH = "PAYLOAD_RECONSTRUCTION_PAYLOAD_ROOT_MISMATCH",
  INVALID_RESPONSE = "PAYLOAD_RECONSTRUCTION_INVALID_RESPONSE",
}

export class PayloadReconstructionError extends LodestarError<{
  code: PayloadReconstructionErrorCode;
  slot: Slot;
  blockHash: RootHex;
}> {}
