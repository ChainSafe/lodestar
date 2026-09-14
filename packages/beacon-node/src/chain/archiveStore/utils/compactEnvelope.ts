import {ssz} from "@lodestar/types";
import {
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

/**
 * Trim an execution payload envelope to its compact archive form: the payload's
 * transactions/withdrawals lists are dropped in favor of their SSZ roots. The block
 * access list and slotNumber are retained — engine_getPayloadBodiesByHash does not
 * return the BAL, so it cannot be refetched. Reconstruct with {@link signedCompactEnvelopeToFull}.
 */
export function toCompactEnvelope(envelope: ExecutionPayloadEnvelope): CompactExecutionPayloadEnvelope {
  const {transactions, withdrawals, ...rest} = envelope.payload;
  return {
    ...envelope,
    payload: {
      ...rest,
      transactionsRoot: ssz.gloas.Transactions.hashTreeRoot(transactions),
      withdrawalsRoot: ssz.gloas.Withdrawals.hashTreeRoot(withdrawals),
    },
  };
}

export function toSignedCompactEnvelope(
  envelope: SignedExecutionPayloadEnvelope
): SignedCompactExecutionPayloadEnvelope {
  return {message: toCompactEnvelope(envelope.message), signature: envelope.signature};
}

/**
 * Rebuild the full signed envelope from its compact form plus transactions/withdrawals
 * refetched from the EL. Verifies both reconstructed roots against the stored roots so a
 * faulty EL response cannot silently corrupt the served envelope; the signature is carried
 * verbatim. Throws {@link EnvelopeReconstructionError} on a root mismatch.
 */
export function signedCompactEnvelopeToFull(
  compactEnvelope: SignedCompactExecutionPayloadEnvelope,
  transactions: Transactions,
  withdrawals: Withdrawals
): SignedExecutionPayloadEnvelope {
  const {payload} = compactEnvelope.message;
  const slot = payload.slotNumber;

  if (!ssz.Root.equals(ssz.gloas.Transactions.hashTreeRoot(transactions), payload.transactionsRoot)) {
    throw new EnvelopeReconstructionError(
      {code: EnvelopeReconstructionErrorCode.TRANSACTIONS_ROOT_MISMATCH, slot},
      `reconstructed transactions root mismatch slot=${slot}`
    );
  }
  if (!ssz.Root.equals(ssz.gloas.Withdrawals.hashTreeRoot(withdrawals), payload.withdrawalsRoot)) {
    throw new EnvelopeReconstructionError(
      {code: EnvelopeReconstructionErrorCode.WITHDRAWALS_ROOT_MISMATCH, slot},
      `reconstructed withdrawals root mismatch slot=${slot}`
    );
  }

  return {
    message: {...compactEnvelope.message, payload: {...payload, transactions, withdrawals}},
    signature: compactEnvelope.signature,
  };
}
