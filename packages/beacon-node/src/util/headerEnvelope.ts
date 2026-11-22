import {ssz} from "@lodestar/types";
import {
  BlockAccessList,
  ExecutionPayloadEnvelope,
  ExecutionPayloadHeaderEnvelope,
  SignedExecutionPayloadEnvelope,
  SignedExecutionPayloadHeaderEnvelope,
  Transactions,
  Withdrawals,
} from "@lodestar/types/gloas";
import {toRootHex} from "@lodestar/utils";
import {
  EnvelopeReconstructionError,
  EnvelopeReconstructionErrorCode,
} from "../chain/errors/envelopeReconstructionError.js";

/** The parts of an execution payload the EL serves back via engine_getPayloadBodiesByHashV2 */
export type ExecutionPayloadBodies = {
  transactions: Transactions;
  withdrawals: Withdrawals;
  blockAccessList: BlockAccessList;
};

export type ExecutionPayloadBodyField = keyof ExecutionPayloadBodies;

const {transactions, withdrawals, blockAccessList} = ssz.gloas.ExecutionPayload.fields;

/** Replace the three body lists by their roots; hashes to the same root as the full envelope */
export function toHeaderEnvelope(envelope: ExecutionPayloadEnvelope): ExecutionPayloadHeaderEnvelope {
  const {payload, ...envelopeFields} = envelope;
  const {transactions: txs, withdrawals: wds, blockAccessList: bal, ...scalars} = payload;
  return {
    ...envelopeFields,
    payloadHeader: {
      ...scalars,
      transactionsRoot: transactions.hashTreeRoot(txs),
      withdrawalsRoot: withdrawals.hashTreeRoot(wds),
      blockAccessListRoot: blockAccessList.hashTreeRoot(bal),
    },
  };
}

export function toSignedHeaderEnvelope(envelope: SignedExecutionPayloadEnvelope): SignedExecutionPayloadHeaderEnvelope {
  return {message: toHeaderEnvelope(envelope.message), signature: envelope.signature};
}

/**
 * Rebuild the full signed envelope from header envelope + EL bodies, each body verified against its stored
 * root. Throws {@link EnvelopeReconstructionError} BODY_ROOT_MISMATCH naming the first body that differs.
 */
export function signedHeaderEnvelopeToFull(
  headerEnvelope: SignedExecutionPayloadHeaderEnvelope,
  bodies: ExecutionPayloadBodies
): SignedExecutionPayloadEnvelope {
  const {payloadHeader, ...envelopeFields} = headerEnvelope.message;
  const {transactionsRoot, withdrawalsRoot, blockAccessListRoot, ...scalars} = payloadHeader;
  const slot = scalars.slotNumber;

  assertBodyRoot("transactions", slot, transactionsRoot, transactions.hashTreeRoot(bodies.transactions));
  assertBodyRoot("withdrawals", slot, withdrawalsRoot, withdrawals.hashTreeRoot(bodies.withdrawals));
  assertBodyRoot("blockAccessList", slot, blockAccessListRoot, blockAccessList.hashTreeRoot(bodies.blockAccessList));

  return {
    message: {...envelopeFields, payload: {...scalars, ...bodies}},
    signature: headerEnvelope.signature,
  };
}

function assertBodyRoot(field: ExecutionPayloadBodyField, slot: number, stored: Uint8Array, rebuilt: Uint8Array): void {
  if (!ssz.Root.equals(stored, rebuilt)) {
    throw new EnvelopeReconstructionError(
      {code: EnvelopeReconstructionErrorCode.BODY_ROOT_MISMATCH, slot, field},
      `reconstructed ${field} root mismatch slot=${slot} stored=${toRootHex(stored)} rebuilt=${toRootHex(rebuilt)}`
    );
  }
}
