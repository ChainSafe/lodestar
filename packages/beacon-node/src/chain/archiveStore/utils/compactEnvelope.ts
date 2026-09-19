import {ssz} from "@lodestar/types";
import {
  BlockAccessList,
  ExecutionPayloadEnvelope,
  SignedExecutionPayloadEnvelope,
  Transactions,
  Withdrawals,
} from "@lodestar/types/gloas";
import {
  CompactExecutionPayloadEnvelope,
  SignedCompactExecutionPayloadEnvelope,
} from "../../../db/repositories/executionPayloadEnvelopeArchive.js";
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

/** Drop transactions, withdrawals and BAL, keep the full payload's root for {@link signedCompactEnvelopeToFull} */
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
 * Rebuild the full signed envelope from compact + EL bodies, verified against the archived payloadRoot.
 * Throws {@link EnvelopeReconstructionError} PAYLOAD_ROOT_MISMATCH.
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
