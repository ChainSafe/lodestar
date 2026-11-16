import {describe, expect, it} from "vitest";
import {ContainerType, SerializedList, Type} from "@chainsafe/ssz";
import {ForkName, isForkPostGloas} from "@lodestar/params";
import {gloas, ssz, sszTypesFor} from "@lodestar/types";
import {EnvelopeReconstructionError, EnvelopeReconstructionErrorCode} from "../../../src/chain/errors/index.js";
import {decodeArchivedEnvelope, encodeArchivedHeaderEnvelope} from "../../../src/db/repositories/index.js";
import type {ExecutionPayloadBodies} from "../../../src/util/headerEnvelope.js";
import {headerEnvelopeToFull, toHeaderEnvelope} from "../../../src/util/headerEnvelope.js";
import {generateExecutionPayloadEnvelope, payloadBodiesOf} from "../../utils/typeGenerator.js";

const bodiesOf = payloadBodiesOf;

// Serialize the header form through bytes and back, mirroring the archive round-trip
// before handing to the real reconstruct fn, proving it survives persistence.
function persistedHeaderEnvelope(
  envelope: gloas.ExecutionPayloadEnvelope
): ReturnType<typeof ssz.gloas.ExecutionPayloadHeaderEnvelope.deserialize> {
  const bytes = ssz.gloas.ExecutionPayloadHeaderEnvelope.serialize(toHeaderEnvelope(envelope));
  return ssz.gloas.ExecutionPayloadHeaderEnvelope.deserialize(bytes);
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

  it("hashes to the same root as the full envelope and payload", () => {
    const envelope = generateExecutionPayloadEnvelope(8);
    const headerEnvelope = toHeaderEnvelope(envelope);
    expect(
      ssz.gloas.ExecutionPayloadHeaderEnvelope.fields.payloadHeader.hashTreeRoot(headerEnvelope.payloadHeader)
    ).toEqual(ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.payload));
    expect(ssz.gloas.ExecutionPayloadHeaderEnvelope.hashTreeRoot(headerEnvelope)).toEqual(
      ssz.gloas.ExecutionPayloadEnvelope.hashTreeRoot(envelope)
    );
  });

  it("stores the three body roots and drops the bodies", () => {
    const envelope = generateExecutionPayloadEnvelope(8);
    const p = envelope.payload;
    const headerEnvelope = toHeaderEnvelope(envelope);
    const fields = ssz.gloas.ExecutionPayload.fields;
    expect(headerEnvelope.payloadHeader.transactionsRoot).toEqual(fields.transactions.hashTreeRoot(p.transactions));
    expect(headerEnvelope.payloadHeader.withdrawalsRoot).toEqual(fields.withdrawals.hashTreeRoot(p.withdrawals));
    expect(headerEnvelope.payloadHeader.blockAccessListRoot).toEqual(
      fields.blockAccessList.hashTreeRoot(p.blockAccessList)
    );
    expect(headerEnvelope.payloadHeader).not.toHaveProperty("transactions");
    expect(headerEnvelope.payloadHeader).not.toHaveProperty("withdrawals");
    expect(headerEnvelope.payloadHeader).not.toHaveProperty("blockAccessList");
  });

  it("header envelope size is independent of body size", () => {
    const envelope = generateExecutionPayloadEnvelope(8);
    const p = envelope.payload;
    p.transactions = SerializedList.fromArray(Array.from({length: 180}, (_, i) => new Uint8Array(1078).fill(i & 0xff)));
    p.blockAccessList = new Uint8Array(70 * 1024).fill(0xab);

    const full = ssz.gloas.ExecutionPayloadEnvelope.serialize(envelope).length;
    const headerEnvelope = ssz.gloas.ExecutionPayloadHeaderEnvelope.serialize(toHeaderEnvelope(envelope)).length;

    expect(headerEnvelope).toBeLessThan(1500);
    expect(full - headerEnvelope).toBeGreaterThan(260_000);
  });

  it("full and header envelopes both start with 0x48, so the 0x00 archive prefix is unambiguous", () => {
    const full = generateExecutionPayloadEnvelope(8);
    expect(ssz.gloas.ExecutionPayloadEnvelope.serialize(full)[0]).toBe(0x48);
    expect(ssz.gloas.ExecutionPayloadHeaderEnvelope.serialize(toHeaderEnvelope(full))[0]).toBe(0x48);
  });

  it("archive framing round-trips: raw full bytes stay full, prefixed header decodes to the header envelope", () => {
    const full = generateExecutionPayloadEnvelope(8);
    const fullBytes = ssz.gloas.ExecutionPayloadEnvelope.serialize(full);
    expect(decodeArchivedEnvelope(fullBytes).envelopeBytes).toBe(fullBytes);

    const headerEnvelope = toHeaderEnvelope(full);
    const decoded = decodeArchivedEnvelope(encodeArchivedHeaderEnvelope(headerEnvelope)).headerEnvelope;
    if (decoded === undefined) throw Error("expected a header entry");
    expect(ssz.gloas.ExecutionPayloadHeaderEnvelope.equals(decoded, headerEnvelope)).toBe(true);
  });

  it("header envelope round-trips through bytes", () => {
    const headerEnvelope = toHeaderEnvelope(generateExecutionPayloadEnvelope(8));
    const bytes = ssz.gloas.ExecutionPayloadHeaderEnvelope.serialize(headerEnvelope);
    const decoded = ssz.gloas.ExecutionPayloadHeaderEnvelope.deserialize(bytes);
    expect(ssz.gloas.ExecutionPayloadHeaderEnvelope.equals(headerEnvelope, decoded)).toBe(true);
  });

  it("header envelope + bodies reconstruct the original byte-identically", () => {
    const envelope = generateExecutionPayloadEnvelope(8);
    const rebuilt = headerEnvelopeToFull(persistedHeaderEnvelope(envelope), bodiesOf(envelope));
    expect(ssz.gloas.ExecutionPayloadEnvelope.equals(rebuilt, envelope)).toBe(true);
  });

  it("reconstructs an empty-body envelope byte-identically", () => {
    const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue(); // empty tx/withdrawals/BAL
    const rebuilt = headerEnvelopeToFull(persistedHeaderEnvelope(envelope), bodiesOf(envelope));
    expect(ssz.gloas.ExecutionPayloadEnvelope.equals(rebuilt, envelope)).toBe(true);
  });

  it.each<[keyof ExecutionPayloadBodies, Partial<ExecutionPayloadBodies>]>([
    ["transactions", {transactions: SerializedList.fromArray([Uint8Array.from([9, 9, 9])])}],
    ["withdrawals", {withdrawals: [{index: 9, validatorIndex: 9, address: new Uint8Array(20).fill(0x11), amount: 1n}]}],
    ["blockAccessList", {blockAccessList: Uint8Array.from([0xff])}],
  ])("throws BODY_ROOT_MISMATCH naming %s when the EL-served body differs from the original", (field, override) => {
    const envelope = generateExecutionPayloadEnvelope(8);
    let err: unknown = null;
    try {
      headerEnvelopeToFull(persistedHeaderEnvelope(envelope), {...bodiesOf(envelope), ...override});
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
