import {ForkName} from "@lodestar/params";
import {RootHex, ValidatorIndex, eip8025} from "@lodestar/types";
import {GossipActionError} from "./gossipValidation.js";

export enum ExecutionProofErrorCode {
  EMPTY_PROOF_DATA = "EXECUTION_PROOF_ERROR_EMPTY_PROOF_DATA",
  UNSUPPORTED_PROOF_TYPE = "EXECUTION_PROOF_ERROR_UNSUPPORTED_PROOF_TYPE",
  BLOCK_ROOT_UNKNOWN = "EXECUTION_PROOF_ERROR_BLOCK_ROOT_UNKNOWN",
  PROOF_ALREADY_KNOWN = "EXECUTION_PROOF_ERROR_PROOF_ALREADY_KNOWN",
  PROOF_ALREADY_PROCESSED = "EXECUTION_PROOF_ERROR_PROOF_ALREADY_PROCESSED",
  PROVER_ALREADY_SEEN = "EXECUTION_PROOF_ERROR_PROVER_ALREADY_SEEN",
  PAYLOAD_UNAVAILABLE = "EXECUTION_PROOF_ERROR_PAYLOAD_UNAVAILABLE",
  UNKNOWN_BLOCK_STATE = "EXECUTION_PROOF_ERROR_UNKNOWN_BLOCK_STATE",
  PRE_GLOAS_BLOCK = "EXECUTION_PROOF_ERROR_PRE_GLOAS_BLOCK",
  VALIDATOR_INDEX_OUT_OF_RANGE = "EXECUTION_PROOF_ERROR_VALIDATOR_INDEX_OUT_OF_RANGE",
  VALIDATOR_NOT_ACTIVE = "EXECUTION_PROOF_ERROR_VALIDATOR_NOT_ACTIVE",
  INVALID_SIGNATURE = "EXECUTION_PROOF_ERROR_INVALID_SIGNATURE",
  INVALID_PROOF = "EXECUTION_PROOF_ERROR_INVALID_PROOF",
}

type ProofContext = {blockRoot: RootHex; proofType: eip8025.ProofType};
type ProverContext = ProofContext & {validatorIndex: ValidatorIndex};

export type ExecutionProofErrorType =
  | ({code: ExecutionProofErrorCode.EMPTY_PROOF_DATA} & ProofContext)
  | ({code: ExecutionProofErrorCode.UNSUPPORTED_PROOF_TYPE} & ProofContext)
  | ({code: ExecutionProofErrorCode.BLOCK_ROOT_UNKNOWN} & ProofContext)
  | ({code: ExecutionProofErrorCode.PROOF_ALREADY_KNOWN} & ProofContext)
  | ({code: ExecutionProofErrorCode.PROOF_ALREADY_PROCESSED; proofRoot: RootHex} & ProofContext)
  | ({code: ExecutionProofErrorCode.PROVER_ALREADY_SEEN} & ProverContext)
  | ({code: ExecutionProofErrorCode.PAYLOAD_UNAVAILABLE} & ProofContext)
  | ({code: ExecutionProofErrorCode.UNKNOWN_BLOCK_STATE} & ProofContext)
  | ({code: ExecutionProofErrorCode.PRE_GLOAS_BLOCK; fork: ForkName} & ProofContext)
  | ({code: ExecutionProofErrorCode.VALIDATOR_INDEX_OUT_OF_RANGE; validatorCount: number} & ProverContext)
  | ({code: ExecutionProofErrorCode.VALIDATOR_NOT_ACTIVE} & ProverContext)
  | ({code: ExecutionProofErrorCode.INVALID_SIGNATURE} & ProverContext)
  | ({code: ExecutionProofErrorCode.INVALID_PROOF} & ProverContext);

export class ExecutionProofError extends GossipActionError<ExecutionProofErrorType> {}
