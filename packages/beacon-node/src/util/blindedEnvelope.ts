import {ssz} from "@lodestar/types";
import {
  BlindedExecutionPayloadEnvelope,
  BlockAccessList,
  ExecutionPayloadEnvelope,
  SignedBlindedExecutionPayloadEnvelope,
  SignedExecutionPayloadEnvelope,
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
export function toBlindedEnvelope(envelope: ExecutionPayloadEnvelope): BlindedExecutionPayloadEnvelope {
  const {transactions: txs, withdrawals: wds, blockAccessList: bal, ...scalars} = envelope.payload;
  return {
    ...envelope,
    payload: {
      ...scalars,
      transactionsRoot: transactions.hashTreeRoot(txs),
      withdrawalsRoot: withdrawals.hashTreeRoot(wds),
      blockAccessListRoot: blockAccessList.hashTreeRoot(bal),
    },
  };
}

export function toSignedBlindedEnvelope(
  envelope: SignedExecutionPayloadEnvelope
): SignedBlindedExecutionPayloadEnvelope {
  return {message: toBlindedEnvelope(envelope.message), signature: envelope.signature};
}

/**
 * Rebuild the full signed envelope from blinded + EL bodies, each body verified against its stored
 * root. Throws {@link EnvelopeReconstructionError} BODY_ROOT_MISMATCH naming the first body that differs.
 */
export function signedBlindedEnvelopeToFull(
  blindedEnvelope: SignedBlindedExecutionPayloadEnvelope,
  bodies: ExecutionPayloadBodies
): SignedExecutionPayloadEnvelope {
  const {transactionsRoot, withdrawalsRoot, blockAccessListRoot, ...scalars} = blindedEnvelope.message.payload;
  const slot = scalars.slotNumber;

  assertBodyRoot("transactions", slot, transactionsRoot, transactions.hashTreeRoot(bodies.transactions));
  assertBodyRoot("withdrawals", slot, withdrawalsRoot, withdrawals.hashTreeRoot(bodies.withdrawals));
  assertBodyRoot("blockAccessList", slot, blockAccessListRoot, blockAccessList.hashTreeRoot(bodies.blockAccessList));

  return {
    message: {...blindedEnvelope.message, payload: {...scalars, ...bodies}},
    signature: blindedEnvelope.signature,
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
