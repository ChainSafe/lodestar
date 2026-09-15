import {ssz} from "@lodestar/types";
import {
  BlockAccessList,
  CompactExecutionPayloadEnvelope,
  ExecutionPayloadEnvelope,
  SignedCompactExecutionPayloadEnvelope,
  SignedExecutionPayloadEnvelope,
  Transactions,
  Withdrawals,
} from "@lodestar/types/gloas";
import {
  EnvelopeReconstructionError,
  EnvelopeReconstructionErrorCode,
} from "../../errors/envelopeReconstructionError.js";

/** The parts of an execution payload the EL serves back via engine_getPayloadBodiesByHashV2 */
export type ExecutionPayloadBodies = {
  transactions: Transactions;
  withdrawals: Withdrawals;
  blockAccessList: BlockAccessList;
};

/**
 * Trim an execution payload envelope to its compact archive form: transactions, withdrawals and
 * the block access list are dropped (the EL already stores them) and the hash_tree_root of the
 * full payload is kept so a reconstruction can be verified. Reconstruct with
 * {@link signedCompactEnvelopeToFull}.
 */
export function toCompactEnvelope(envelope: ExecutionPayloadEnvelope): CompactExecutionPayloadEnvelope {
  const {transactions: _t, withdrawals: _w, blockAccessList: _b, ...scalars} = envelope.payload;
  return {
    ...envelope,
    payload: {...scalars, payloadRoot: ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.payload)},
  };
}

export function toSignedCompactEnvelope(
  envelope: SignedExecutionPayloadEnvelope
): SignedCompactExecutionPayloadEnvelope {
  return {message: toCompactEnvelope(envelope.message), signature: envelope.signature};
}

/**
 * Rebuild the full signed envelope from its compact form plus the bodies refetched from the EL.
 * The rebuilt payload's hash_tree_root is checked against the archived payloadRoot, so a faulty
 * EL response cannot silently corrupt the served envelope; the signature is carried verbatim.
 * Throws {@link EnvelopeReconstructionError} PAYLOAD_ROOT_MISMATCH on mismatch.
 */
export function signedCompactEnvelopeToFull(
  compactEnvelope: SignedCompactExecutionPayloadEnvelope,
  bodies: ExecutionPayloadBodies
): SignedExecutionPayloadEnvelope {
  const {payloadRoot, ...scalars} = compactEnvelope.message.payload;
  const payload = {...scalars, ...bodies};

  if (!ssz.Root.equals(ssz.gloas.ExecutionPayload.hashTreeRoot(payload), payloadRoot)) {
    throw new EnvelopeReconstructionError(
      {code: EnvelopeReconstructionErrorCode.PAYLOAD_ROOT_MISMATCH, slot: scalars.slotNumber},
      `reconstructed payload root mismatch slot=${scalars.slotNumber}`
    );
  }

  return {message: {...compactEnvelope.message, payload}, signature: compactEnvelope.signature};
}
