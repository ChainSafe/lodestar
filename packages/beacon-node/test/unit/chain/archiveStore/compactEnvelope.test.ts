import {describe, expect, it} from "vitest";
import {ssz} from "@lodestar/types";
import {
  signedCompactEnvelopeToFull,
  toSignedCompactEnvelope,
} from "../../../../src/chain/archiveStore/utils/compactEnvelope.js";

function populatedEnvelope(): ReturnType<typeof ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue> {
  const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
  const p = envelope.message.payload;
  p.transactions = [Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5, 6])];
  p.withdrawals = [{index: 1, validatorIndex: 2, address: new Uint8Array(20).fill(0xdd), amount: 99n}];
  p.blockHash = new Uint8Array(32).fill(0xaa);
  p.stateRoot = new Uint8Array(32).fill(0xbb);
  p.blockNumber = 42;
  p.slotNumber = 8; // GLOAS:EIP-7843
  p.blockAccessList = Uint8Array.from([0x11, 0x22, 0x33]); // GLOAS:EIP-7928
  envelope.message.builderIndex = 7;
  envelope.message.beaconBlockRoot = new Uint8Array(32).fill(0xcc);
  envelope.message.parentBeaconBlockRoot = new Uint8Array(32).fill(0x99);
  envelope.signature = new Uint8Array(96).fill(0xee);
  return envelope;
}

// Serialize the compact through bytes and back, mirroring the archive round-trip
// before handing to the real reconstruct fn — proves it survives persistence.
function persistedCompact(
  envelope: ReturnType<typeof ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue>
): ReturnType<typeof ssz.gloas.SignedCompactExecutionPayloadEnvelope.deserialize> {
  const bytes = ssz.gloas.SignedCompactExecutionPayloadEnvelope.serialize(toSignedCompactEnvelope(envelope));
  return ssz.gloas.SignedCompactExecutionPayloadEnvelope.deserialize(bytes);
}

describe("compactEnvelope", () => {
  it("computes transactions/withdrawals roots", () => {
    const envelope = populatedEnvelope();
    const compact = toSignedCompactEnvelope(envelope);
    expect(compact.message.payload.transactionsRoot).toEqual(
      ssz.gloas.Transactions.hashTreeRoot(envelope.message.payload.transactions)
    );
    expect(compact.message.payload.withdrawalsRoot).toEqual(
      ssz.gloas.Withdrawals.hashTreeRoot(envelope.message.payload.withdrawals)
    );
  });

  it("compact type round-trips through bytes", () => {
    const compact = toSignedCompactEnvelope(populatedEnvelope());
    const bytes = ssz.gloas.SignedCompactExecutionPayloadEnvelope.serialize(compact);
    const decoded = ssz.gloas.SignedCompactExecutionPayloadEnvelope.deserialize(bytes);
    expect(ssz.gloas.SignedCompactExecutionPayloadEnvelope.equals(compact, decoded)).toBe(true);
  });

  it("compact + bodies reconstruct the original byte-identically", () => {
    const envelope = populatedEnvelope();
    const rebuilt = signedCompactEnvelopeToFull(
      persistedCompact(envelope),
      envelope.message.payload.transactions,
      envelope.message.payload.withdrawals
    );
    expect(ssz.gloas.SignedExecutionPayloadEnvelope.equals(rebuilt, envelope)).toBe(true);
  });

  it("reconstructs an empty-body envelope byte-identically", () => {
    const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue(); // empty tx/withdrawals
    const rebuilt = signedCompactEnvelopeToFull(
      persistedCompact(envelope),
      envelope.message.payload.transactions,
      envelope.message.payload.withdrawals
    );
    expect(ssz.gloas.SignedExecutionPayloadEnvelope.equals(rebuilt, envelope)).toBe(true);
  });

  it("throws when reconstructed transactions don't match the stored root", () => {
    const envelope = populatedEnvelope();
    const wrongTx = [Uint8Array.from([9, 9, 9])];
    expect(() =>
      signedCompactEnvelopeToFull(persistedCompact(envelope), wrongTx, envelope.message.payload.withdrawals)
    ).toThrow(/transactions root mismatch/);
  });

  it("throws when reconstructed withdrawals don't match the stored root", () => {
    const envelope = populatedEnvelope();
    const wrongWd = [{index: 9, validatorIndex: 9, address: new Uint8Array(20).fill(0x11), amount: 1n}];
    expect(() =>
      signedCompactEnvelopeToFull(persistedCompact(envelope), envelope.message.payload.transactions, wrongWd)
    ).toThrow(/withdrawals root mismatch/);
  });
});
