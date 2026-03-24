import {ByteListType, ContainerType, ListBasicType, UintNumberType} from "@chainsafe/ssz";
import {EXECUTION_PROOF_TYPE_COUNT, MAX_PROOF_DATA_BYTES} from "@lodestar/params";
import {BLSSignature, Root, Slot, Uint8, UintNum64, ValidatorIndex} from "../primitive/sszTypes.js";

/**
 * ExecutionProofId identifies which zkVM/proof system + EL combination a proof belongs to.
 * Examples: 0=SP1+Reth, 1=Risc0+Geth, 2=SP1+Geth, etc.
 *
 * Note: Uses Uint8 (uint8) per Lighthouse/Prysm devnet implementation.
 */
export const ExecutionProofId = Uint8;

/**
 * Identifies the proof system type.
 */
export const ProofType = Uint8;

/**
 * The actual proof data, variable length up to MAX_PROOF_DATA_BYTES.
 */
export const ProofData = new ByteListType(MAX_PROOF_DATA_BYTES);

export const PublicInput = new ContainerType(
  {
    newPayloadRequestRoot: Root,
  },
  {typeName: "PublicInput", jsonCase: "eth2"}
);

/**
 * ExecutionProof represents a cryptographic proof that an execution payload is valid.
 *
 * Note: This type matches the Lighthouse/Prysm devnet wire format, which diverges from
 * the consensus spec (no BLS signatures, extra fields for slot/blockHash/blockRoot).
 * The consensus spec uses SignedExecutionProof with validator_index + BLS signature,
 * but for devnet interop we match the actual implementation.
 */
export const ExecutionProof = new ContainerType(
  {
    /** The actual ZK proof data */
    proofData: ProofData,
    proofType: ProofType,
    /**
     * Public input of an [`ExecutionProof`].
     * Contains the tree hash root of the new payload request that the proof is associated with.
     **/
    publicInput: PublicInput,
  },
  {typeName: "ExecutionProof", jsonCase: "eth2"}
);

export const SignedExecutionProof = new ContainerType(
  {
    /** The actual ZK proof data */
    message: ExecutionProof,
    validatorIndex: ValidatorIndex,
    signature: BLSSignature,
  },
  {typeName: "SignedExecutionProof", jsonCase: "eth2"}
);

/**
 * Request proofs for a specific block root.
 * Matches Lighthouse `ExecutionProofsByRootRequest` wire format.
 */
export const ExecutionProofsByRootRequest = new ContainerType(
  {
    /** The block root we need proofs for */
    blockRoot: Root,
    /** How many additional proofs we need */
    countNeeded: UintNum64,
    /** Proof IDs we already have (responder should exclude these) */
    alreadyHave: new ListBasicType(new UintNumberType(1), EXECUTION_PROOF_TYPE_COUNT),
  },
  {typeName: "ExecutionProofsByRootRequest", jsonCase: "eth2"}
);

/**
 * Request proofs for a range of slots.
 * Matches Lighthouse `ExecutionProofsByRangeRequest` wire format.
 */
export const ExecutionProofsByRangeRequest = new ContainerType(
  {
    /** The starting slot to request execution proofs */
    startSlot: UintNum64,
    /** The number of slots from the start slot */
    count: UintNum64,
  },
  {typeName: "ExecutionProofsByRangeRequest", jsonCase: "eth2"}
);
