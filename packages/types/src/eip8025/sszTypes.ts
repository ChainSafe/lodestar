import {ByteListType, ContainerType, ProgressiveContainerType} from "@chainsafe/ssz";
import {MAX_PROOF_SIZE} from "@lodestar/params";
import * as primitiveSsz from "../primitive/sszTypes.js";

const {BLSSignature, Root, Uint8, Uint16, UintBn64, ValidatorIndex} = primitiveSsz;

export const ProofData = new ByteListType(MAX_PROOF_SIZE, {typeName: "ProofData"});
export const ProofType = Uint8;

export const PublicInput = new ProgressiveContainerType(
  {
    newPayloadRequestRoot: Root,
    successfulValidation: primitiveSsz.Boolean,
    chainId: UintBn64,
    schemaId: Uint16,
  },
  [true, true, true, true],
  {typeName: "PublicInput", jsonCase: "eth2"}
);

export const ExecutionProof = new ContainerType(
  {
    proofData: ProofData,
    proofType: ProofType,
    publicInput: PublicInput,
  },
  {typeName: "ExecutionProof", jsonCase: "eth2"}
);

export const ExecutionProofEnvelope = new ContainerType(
  {
    proofData: ProofData,
    proofType: ProofType,
    beaconBlockRoot: Root,
  },
  {typeName: "ExecutionProofEnvelope", jsonCase: "eth2"}
);

export const SignedExecutionProofEnvelope = new ContainerType(
  {
    message: ExecutionProofEnvelope,
    validatorIndex: ValidatorIndex,
    signature: BLSSignature,
  },
  {typeName: "SignedExecutionProofEnvelope", jsonCase: "eth2"}
);
