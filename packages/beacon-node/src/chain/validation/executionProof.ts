import {
  computeEpochAtSlot,
  getExecutionProofEnvelopeSignatureSet,
  isActiveValidator,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {Slot, eip8025, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionProofError, ExecutionProofErrorCode, GossipAction} from "../errors/index.js";
import {IBeaconChain} from "../index.js";
import {getExecutionProof} from "../proofEngine/index.js";
import {RegenCaller} from "../regen/index.js";

export async function validateApiExecutionProof(
  chain: IBeaconChain,
  signedProofEnvelope: eip8025.SignedExecutionProofEnvelope
): Promise<{blockSlot: Slot}> {
  return validateGossipExecutionProof(chain, signedProofEnvelope);
}

export async function validateGossipExecutionProof(
  chain: IBeaconChain,
  signedProofEnvelope: eip8025.SignedExecutionProofEnvelope
): Promise<{blockSlot: Slot}> {
  const proofEnvelope = signedProofEnvelope.message;
  const {proofType} = proofEnvelope;
  const {validatorIndex} = signedProofEnvelope;
  const blockRoot = toRootHex(proofEnvelope.beaconBlockRoot);

  // [REJECT] The proof data is non-empty
  if (proofEnvelope.proofData.length === 0) {
    throw new ExecutionProofError(GossipAction.REJECT, {
      code: ExecutionProofErrorCode.EMPTY_PROOF_DATA,
      blockRoot,
      proofType,
    });
  }

  // [REJECT] The proof type is supported (spec `get_supported_proof_types` plus explicit assignments)
  if (!chain.proofEngine.supportedProofTypes.has(proofType)) {
    throw new ExecutionProofError(GossipAction.REJECT, {
      code: ExecutionProofErrorCode.UNSUPPORTED_PROOF_TYPE,
      blockRoot,
      proofType,
    });
  }

  // A supported type this node holds no verification key for can be neither confirmed nor refuted,
  // so the proof is dropped without forwarding it or penalizing the peer
  if (!chain.proofEngine.verifiableProofTypes.has(proofType)) {
    throw new ExecutionProofError(GossipAction.IGNORE, {
      code: ExecutionProofErrorCode.PROOF_TYPE_NOT_VERIFIABLE,
      blockRoot,
      proofType,
    });
  }

  // [IGNORE] The proof's beacon block has been seen
  const block = chain.forkChoice.getBlockHexDefaultStatus(blockRoot);
  if (block === null) {
    throw new ExecutionProofError(GossipAction.IGNORE, {
      code: ExecutionProofErrorCode.BLOCK_ROOT_UNKNOWN,
      blockRoot,
      proofType,
    });
  }

  // [IGNORE] No valid proof is known for this beacon block and proof type
  if (chain.seenExecutionProofs.hasVerified(blockRoot, proofType)) {
    throw new ExecutionProofError(GossipAction.IGNORE, {
      code: ExecutionProofErrorCode.PROOF_ALREADY_KNOWN,
      blockRoot,
      proofType,
    });
  }

  // [IGNORE] The proof has not already been processed
  const proofRoot = toRootHex(ssz.eip8025.ExecutionProofEnvelope.hashTreeRoot(proofEnvelope));
  if (chain.seenExecutionProofs.isProofSeen(blockRoot, proofRoot)) {
    throw new ExecutionProofError(GossipAction.IGNORE, {
      code: ExecutionProofErrorCode.PROOF_ALREADY_PROCESSED,
      blockRoot,
      proofType,
      proofRoot,
    });
  }

  // [IGNORE] This is the prover's first valid or invalid proof for this key
  if (chain.seenExecutionProofs.isProverSeen(blockRoot, proofType, validatorIndex)) {
    throw new ExecutionProofError(GossipAction.IGNORE, {
      code: ExecutionProofErrorCode.PROVER_ALREADY_SEEN,
      blockRoot,
      proofType,
      validatorIndex,
    });
  }

  // [IGNORE] The proof's execution payload is available (spec `store.payloads`, so imported, not just seen)
  const payloadInput = chain.forkChoice.hasPayloadHexUnsafe(blockRoot)
    ? await chain.seenPayloadEnvelopeInputCache.getOrReload(blockRoot)
    : undefined;
  if (payloadInput === undefined || !payloadInput.hasPayloadEnvelope()) {
    throw new ExecutionProofError(GossipAction.IGNORE, {
      code: ExecutionProofErrorCode.PAYLOAD_UNAVAILABLE,
      blockRoot,
      proofType,
    });
  }

  const state = await chain.regen.getState(block.stateRoot, RegenCaller.validateGossipExecutionProof).catch(() => {
    throw new ExecutionProofError(GossipAction.IGNORE, {
      code: ExecutionProofErrorCode.UNKNOWN_BLOCK_STATE,
      blockRoot,
      proofType,
    });
  });
  if (!isStatePostGloas(state)) {
    throw new ExecutionProofError(GossipAction.IGNORE, {
      code: ExecutionProofErrorCode.PRE_GLOAS_BLOCK,
      blockRoot,
      proofType,
      fork: state.forkName,
    });
  }

  // [REJECT] The execution proof envelope passes validation (spec `verify_execution_proof_envelope`)
  if (validatorIndex >= state.validatorCount) {
    throw new ExecutionProofError(GossipAction.REJECT, {
      code: ExecutionProofErrorCode.VALIDATOR_INDEX_OUT_OF_RANGE,
      blockRoot,
      proofType,
      validatorIndex,
      validatorCount: state.validatorCount,
    });
  }

  if (!isActiveValidator(state.getValidator(validatorIndex), computeEpochAtSlot(state.slot))) {
    throw new ExecutionProofError(GossipAction.REJECT, {
      code: ExecutionProofErrorCode.VALIDATOR_NOT_ACTIVE,
      blockRoot,
      proofType,
      validatorIndex,
    });
  }

  const signatureSet = getExecutionProofEnvelopeSignatureSet(chain.config, state, signedProofEnvelope);
  if (!(await chain.bls.verifySignatureSets([signatureSet], {verifyOnMainThread: true}))) {
    throw new ExecutionProofError(GossipAction.REJECT, {
      code: ExecutionProofErrorCode.INVALID_SIGNATURE,
      blockRoot,
      proofType,
      validatorIndex,
    });
  }

  const proof = getExecutionProof(chain.config, payloadInput, proofEnvelope);

  // Only authenticated proofs count against the prover, so a forged envelope cannot block a validator
  chain.seenExecutionProofs.markSeen(blockRoot, block.slot, proofRoot, proofType, validatorIndex);

  // [REJECT] The execution proof is valid
  if (!(await chain.proofEngine.verifyExecutionProof(proof))) {
    throw new ExecutionProofError(GossipAction.REJECT, {
      code: ExecutionProofErrorCode.INVALID_PROOF,
      blockRoot,
      proofType,
      validatorIndex,
    });
  }

  chain.seenExecutionProofs.addVerified(blockRoot, block.slot, proofEnvelope);

  return {blockSlot: block.slot};
}
