import {describe, expect, it} from "vitest";
import {ContainerType, Type} from "@chainsafe/ssz";
import {ForkName, isForkPostGloas} from "@lodestar/params";
import {ssz, sszTypesFor} from "@lodestar/types";
import type {ExecutionPayloadBodies} from "../../../../src/chain/archiveStore/utils/compactEnvelope.js";
import {
  signedCompactEnvelopeToFull,
  toSignedCompactEnvelope,
} from "../../../../src/chain/archiveStore/utils/compactEnvelope.js";
import {EnvelopeReconstructionError, EnvelopeReconstructionErrorCode} from "../../../../src/chain/errors/index.js";
import {
  compactExecutionPayloadSsz,
  signedCompactExecutionPayloadEnvelopeSsz,
} from "../../../../src/db/repositories/index.js";
import {generateSignedExecutionPayloadEnvelope} from "../../../utils/typeGenerator.js";

type SignedEnvelope = ReturnType<typeof ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue>;

function bodiesOf(envelope: SignedEnvelope): Parameters<typeof signedCompactEnvelopeToFull>[1] {
  const {transactions, withdrawals, blockAccessList} = envelope.message.payload;
  return {transactions, withdrawals, blockAccessList};
}

// Serialize the compact through bytes and back, mirroring the archive round-trip
// before handing to the real reconstruct fn — proves it survives persistence.
function persistedCompact(
  envelope: SignedEnvelope
): ReturnType<typeof signedCompactExecutionPayloadEnvelopeSsz.deserialize> {
  const bytes = signedCompactExecutionPayloadEnvelopeSsz.serialize(toSignedCompactEnvelope(envelope));
  return signedCompactExecutionPayloadEnvelopeSsz.deserialize(bytes);
}

describe("compactEnvelope", () => {
  // The compact scalars are derived from the electra header, not from the payload being compacted.
  // If a later fork adds a scalar to ExecutionPayload, the compact form would drop it on write and
  // the payloadRoot check could not catch it (both sides hash the same container). Pin the field set.
  const postGloasForks = Object.values(ForkName).filter(isForkPostGloas);
  it.each(postGloasForks)("compact scalars + bodies cover every %s ExecutionPayload field", (fork) => {
    const compactFields = Object.keys(compactExecutionPayloadSsz.fields).filter((f) => f !== "payloadRoot");
    const covered = [...compactFields, "transactions", "withdrawals", "blockAccessList"].sort();
    const payloadType = sszTypesFor(fork, "ExecutionPayload") as unknown as ContainerType<
      Record<string, Type<unknown>>
    >;
    const payloadFields = Object.keys(payloadType.fields).sort();
    expect(covered).toEqual(payloadFields);
  });

  it("stores the full payload root and drops transactions, withdrawals and the block access list", () => {
    const envelope = generateSignedExecutionPayloadEnvelope(8);
    const compact = toSignedCompactEnvelope(envelope);
    expect(compact.message.payload.payloadRoot).toEqual(
      ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.message.payload)
    );
    expect(compact.message.payload).not.toHaveProperty("transactions");
    expect(compact.message.payload).not.toHaveProperty("withdrawals");
    expect(compact.message.payload).not.toHaveProperty("blockAccessList");
  });

  it("compact size is header-sized regardless of body size", () => {
    const envelope = generateSignedExecutionPayloadEnvelope(8);
    const p = envelope.message.payload;
    p.transactions = Array.from({length: 180}, (_, i) => new Uint8Array(1078).fill(i & 0xff));
    p.blockAccessList = new Uint8Array(70 * 1024).fill(0xab);

    const full = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope).length;
    const compact = signedCompactExecutionPayloadEnvelopeSsz.serialize(toSignedCompactEnvelope(envelope)).length;

    expect(compact).toBeLessThan(1500);
    expect(full - compact).toBeGreaterThan(260_000);
  });

  it("compact type round-trips through bytes", () => {
    const compact = toSignedCompactEnvelope(generateSignedExecutionPayloadEnvelope(8));
    const bytes = signedCompactExecutionPayloadEnvelopeSsz.serialize(compact);
    const decoded = signedCompactExecutionPayloadEnvelopeSsz.deserialize(bytes);
    expect(signedCompactExecutionPayloadEnvelopeSsz.equals(compact, decoded)).toBe(true);
  });

  it("compact + bodies reconstruct the original byte-identically", () => {
    const envelope = generateSignedExecutionPayloadEnvelope(8);
    const rebuilt = signedCompactEnvelopeToFull(persistedCompact(envelope), bodiesOf(envelope));
    expect(ssz.gloas.SignedExecutionPayloadEnvelope.equals(rebuilt, envelope)).toBe(true);
  });

  it("reconstructs an empty-body envelope byte-identically", () => {
    const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue(); // empty tx/withdrawals/BAL
    const rebuilt = signedCompactEnvelopeToFull(persistedCompact(envelope), bodiesOf(envelope));
    expect(ssz.gloas.SignedExecutionPayloadEnvelope.equals(rebuilt, envelope)).toBe(true);
  });

  it.each<[string, Partial<ExecutionPayloadBodies>]>([
    ["transactions", {transactions: [Uint8Array.from([9, 9, 9])]}],
    ["withdrawals", {withdrawals: [{index: 9, validatorIndex: 9, address: new Uint8Array(20).fill(0x11), amount: 1n}]}],
    ["blockAccessList", {blockAccessList: Uint8Array.from([0xff])}],
  ])("throws PAYLOAD_ROOT_MISMATCH when the EL-served %s differ from the original", (_field, override) => {
    const envelope = generateSignedExecutionPayloadEnvelope(8);
    let err: unknown = null;
    try {
      signedCompactEnvelopeToFull(persistedCompact(envelope), {...bodiesOf(envelope), ...override});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EnvelopeReconstructionError);
    expect((err as EnvelopeReconstructionError).type.code).toBe(EnvelopeReconstructionErrorCode.PAYLOAD_ROOT_MISMATCH);
  });
});
