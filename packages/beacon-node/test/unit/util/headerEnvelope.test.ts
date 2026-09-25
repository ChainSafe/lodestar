import {describe, expect, it} from "vitest";
import {ContainerType, Type} from "@chainsafe/ssz";
import {ForkName, isForkPostGloas} from "@lodestar/params";
import {gloas, ssz, sszTypesFor} from "@lodestar/types";
import {EnvelopeReconstructionError, EnvelopeReconstructionErrorCode} from "../../../src/chain/errors/index.js";
import {decodeArchivedEnvelope, encodeArchivedHeaderEnvelope} from "../../../src/db/repositories/index.js";
import type {ExecutionPayloadBodies} from "../../../src/util/headerEnvelope.js";
import {signedHeaderEnvelopeToFull, toSignedHeaderEnvelope} from "../../../src/util/headerEnvelope.js";
import {generateSignedExecutionPayloadEnvelope, payloadBodiesOf} from "../../utils/typeGenerator.js";

const bodiesOf = payloadBodiesOf;

// Serialize the header form through bytes and back, mirroring the archive round-trip
// before handing to the real reconstruct fn, proving it survives persistence.
function persistedHeaderEnvelope(
  envelope: gloas.SignedExecutionPayloadEnvelope
): ReturnType<typeof ssz.gloas.SignedExecutionPayloadHeaderEnvelope.deserialize> {
  const bytes = ssz.gloas.SignedExecutionPayloadHeaderEnvelope.serialize(toSignedHeaderEnvelope(envelope));
  return ssz.gloas.SignedExecutionPayloadHeaderEnvelope.deserialize(bytes);
}

describe("headerEnvelope", () => {
  // The payload header is derived from the Gloas ExecutionPayload type. If a later fork adds a
  // field, the header form would drop it on write and root equality with the full type would
  // silently break for that fork. Pin the field set, position by position.
  const postGloasForks = Object.values(ForkName).filter(isForkPostGloas);
  it.each(postGloasForks)("payload header mirrors the %s ExecutionPayload field layout", (fork) => {
    const payloadType = sszTypesFor(fork, "ExecutionPayload") as unknown as ContainerType<
      Record<string, Type<unknown>>
    >;
    const expected = Object.keys(payloadType.fields).map((f) =>
      f === "transactions" || f === "withdrawals" || f === "blockAccessList" ? `${f}Root` : f
    );
    expect(Object.keys(ssz.gloas.ExecutionPayloadHeaderEnvelope.fields.payloadHeader.fields)).toEqual(expected);
  });

  it("hashes to the same root as the full envelope, payload and message", () => {
    const envelope = generateSignedExecutionPayloadEnvelope(8);
    const headerEnvelope = toSignedHeaderEnvelope(envelope);
    expect(
      ssz.gloas.ExecutionPayloadHeaderEnvelope.fields.payloadHeader.hashTreeRoot(headerEnvelope.message.payloadHeader)
    ).toEqual(ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.message.payload));
    expect(ssz.gloas.ExecutionPayloadHeaderEnvelope.hashTreeRoot(headerEnvelope.message)).toEqual(
      ssz.gloas.ExecutionPayloadEnvelope.hashTreeRoot(envelope.message)
    );
  });

  it("stores the three body roots and drops the bodies", () => {
    const envelope = generateSignedExecutionPayloadEnvelope(8);
    const p = envelope.message.payload;
    const headerEnvelope = toSignedHeaderEnvelope(envelope);
    const fields = ssz.gloas.ExecutionPayload.fields;
    expect(headerEnvelope.message.payloadHeader.transactionsRoot).toEqual(
      fields.transactions.hashTreeRoot(p.transactions)
    );
    expect(headerEnvelope.message.payloadHeader.withdrawalsRoot).toEqual(
      fields.withdrawals.hashTreeRoot(p.withdrawals)
    );
    expect(headerEnvelope.message.payloadHeader.blockAccessListRoot).toEqual(
      fields.blockAccessList.hashTreeRoot(p.blockAccessList)
    );
    expect(headerEnvelope.message.payloadHeader).not.toHaveProperty("transactions");
    expect(headerEnvelope.message.payloadHeader).not.toHaveProperty("withdrawals");
    expect(headerEnvelope.message.payloadHeader).not.toHaveProperty("blockAccessList");
  });

  it("header envelope size is independent of body size", () => {
    const envelope = generateSignedExecutionPayloadEnvelope(8);
    const p = envelope.message.payload;
    p.transactions = Array.from({length: 180}, (_, i) => new Uint8Array(1078).fill(i & 0xff));
    p.blockAccessList = new Uint8Array(70 * 1024).fill(0xab);

    const full = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope).length;
    const headerEnvelope = ssz.gloas.SignedExecutionPayloadHeaderEnvelope.serialize(
      toSignedHeaderEnvelope(envelope)
    ).length;

    expect(headerEnvelope).toBeLessThan(1500);
    expect(full - headerEnvelope).toBeGreaterThan(260_000);
  });

  it("full and header envelopes both start with 0x64, so the 0x00 archive prefix is unambiguous", () => {
    const full = generateSignedExecutionPayloadEnvelope(8);
    expect(ssz.gloas.SignedExecutionPayloadEnvelope.serialize(full)[0]).toBe(0x64);
    expect(ssz.gloas.SignedExecutionPayloadHeaderEnvelope.serialize(toSignedHeaderEnvelope(full))[0]).toBe(0x64);
  });

  it("archive framing round-trips: raw full bytes stay full, prefixed header decodes to the header envelope", () => {
    const full = generateSignedExecutionPayloadEnvelope(8);
    const fullBytes = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(full);
    expect(decodeArchivedEnvelope(fullBytes).envelopeBytes).toBe(fullBytes);

    const headerEnvelope = toSignedHeaderEnvelope(full);
    const decoded = decodeArchivedEnvelope(encodeArchivedHeaderEnvelope(headerEnvelope)).headerEnvelope;
    if (decoded === undefined) throw Error("expected a header entry");
    expect(ssz.gloas.SignedExecutionPayloadHeaderEnvelope.equals(decoded, headerEnvelope)).toBe(true);
  });

  it("header envelope round-trips through bytes", () => {
    const headerEnvelope = toSignedHeaderEnvelope(generateSignedExecutionPayloadEnvelope(8));
    const bytes = ssz.gloas.SignedExecutionPayloadHeaderEnvelope.serialize(headerEnvelope);
    const decoded = ssz.gloas.SignedExecutionPayloadHeaderEnvelope.deserialize(bytes);
    expect(ssz.gloas.SignedExecutionPayloadHeaderEnvelope.equals(headerEnvelope, decoded)).toBe(true);
  });

  it("header envelope + bodies reconstruct the original byte-identically", () => {
    const envelope = generateSignedExecutionPayloadEnvelope(8);
    const rebuilt = signedHeaderEnvelopeToFull(persistedHeaderEnvelope(envelope), bodiesOf(envelope));
    expect(ssz.gloas.SignedExecutionPayloadEnvelope.equals(rebuilt, envelope)).toBe(true);
  });

  it("reconstructs an empty-body envelope byte-identically", () => {
    const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue(); // empty tx/withdrawals/BAL
    const rebuilt = signedHeaderEnvelopeToFull(persistedHeaderEnvelope(envelope), bodiesOf(envelope));
    expect(ssz.gloas.SignedExecutionPayloadEnvelope.equals(rebuilt, envelope)).toBe(true);
  });

  it.each<[keyof ExecutionPayloadBodies, Partial<ExecutionPayloadBodies>]>([
    ["transactions", {transactions: [Uint8Array.from([9, 9, 9])]}],
    ["withdrawals", {withdrawals: [{index: 9, validatorIndex: 9, address: new Uint8Array(20).fill(0x11), amount: 1n}]}],
    ["blockAccessList", {blockAccessList: Uint8Array.from([0xff])}],
  ])("throws BODY_ROOT_MISMATCH naming %s when the EL-served body differs from the original", (field, override) => {
    const envelope = generateSignedExecutionPayloadEnvelope(8);
    let err: unknown = null;
    try {
      signedHeaderEnvelopeToFull(persistedHeaderEnvelope(envelope), {...bodiesOf(envelope), ...override});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EnvelopeReconstructionError);
    const type = (err as EnvelopeReconstructionError).type;
    expect(type.code).toBe(EnvelopeReconstructionErrorCode.BODY_ROOT_MISMATCH);
    if (type.code !== EnvelopeReconstructionErrorCode.BODY_ROOT_MISMATCH) throw Error("unreachable");
    expect(type.field).toBe(field);
    expect(type.slot).toBe(8);
  });
});
