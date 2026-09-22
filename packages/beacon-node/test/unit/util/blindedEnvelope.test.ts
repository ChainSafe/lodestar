import {describe, expect, it} from "vitest";
import {ContainerType, Type} from "@chainsafe/ssz";
import {ForkName, isForkPostGloas} from "@lodestar/params";
import {gloas, ssz, sszTypesFor} from "@lodestar/types";
import {EnvelopeReconstructionError, EnvelopeReconstructionErrorCode} from "../../../src/chain/errors/index.js";
import type {ExecutionPayloadBodies} from "../../../src/util/blindedEnvelope.js";
import {signedBlindedEnvelopeToFull, toSignedBlindedEnvelope} from "../../../src/util/blindedEnvelope.js";
import {generateSignedExecutionPayloadEnvelope, payloadBodiesOf} from "../../utils/typeGenerator.js";

const bodiesOf = payloadBodiesOf;

// Serialize the blinded form through bytes and back, mirroring the archive round-trip
// before handing to the real reconstruct fn, proving it survives persistence.
function persistedBlinded(
  envelope: gloas.SignedExecutionPayloadEnvelope
): ReturnType<typeof ssz.gloas.SignedBlindedExecutionPayloadEnvelope.deserialize> {
  const bytes = ssz.gloas.SignedBlindedExecutionPayloadEnvelope.serialize(toSignedBlindedEnvelope(envelope));
  return ssz.gloas.SignedBlindedExecutionPayloadEnvelope.deserialize(bytes);
}

describe("blindedEnvelope", () => {
  // The blinded payload is derived from the Gloas ExecutionPayload type. If a later fork adds a
  // field, the blinded form would drop it on write and root equality with the full type would
  // silently break for that fork. Pin the field set, position by position.
  const postGloasForks = Object.values(ForkName).filter(isForkPostGloas);
  it.each(postGloasForks)("blinded payload mirrors the %s ExecutionPayload field layout", (fork) => {
    const payloadType = sszTypesFor(fork, "ExecutionPayload") as unknown as ContainerType<
      Record<string, Type<unknown>>
    >;
    const expected = Object.keys(payloadType.fields).map((f) =>
      f === "transactions" || f === "withdrawals" || f === "blockAccessList" ? `${f}Root` : f
    );
    expect(Object.keys(ssz.gloas.BlindedExecutionPayload.fields)).toEqual(expected);
  });

  it("hashes to the same root as the full envelope, payload and message", () => {
    const envelope = generateSignedExecutionPayloadEnvelope(8);
    const blinded = toSignedBlindedEnvelope(envelope);
    expect(ssz.gloas.BlindedExecutionPayload.hashTreeRoot(blinded.message.payload)).toEqual(
      ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.message.payload)
    );
    expect(ssz.gloas.BlindedExecutionPayloadEnvelope.hashTreeRoot(blinded.message)).toEqual(
      ssz.gloas.ExecutionPayloadEnvelope.hashTreeRoot(envelope.message)
    );
  });

  it("stores the three body roots and drops the bodies", () => {
    const envelope = generateSignedExecutionPayloadEnvelope(8);
    const p = envelope.message.payload;
    const blinded = toSignedBlindedEnvelope(envelope);
    const fields = ssz.gloas.ExecutionPayload.fields;
    expect(blinded.message.payload.transactionsRoot).toEqual(fields.transactions.hashTreeRoot(p.transactions));
    expect(blinded.message.payload.withdrawalsRoot).toEqual(fields.withdrawals.hashTreeRoot(p.withdrawals));
    expect(blinded.message.payload.blockAccessListRoot).toEqual(fields.blockAccessList.hashTreeRoot(p.blockAccessList));
    expect(blinded.message.payload).not.toHaveProperty("transactions");
    expect(blinded.message.payload).not.toHaveProperty("withdrawals");
    expect(blinded.message.payload).not.toHaveProperty("blockAccessList");
  });

  it("blinded size is header-sized regardless of body size", () => {
    const envelope = generateSignedExecutionPayloadEnvelope(8);
    const p = envelope.message.payload;
    p.transactions = Array.from({length: 180}, (_, i) => new Uint8Array(1078).fill(i & 0xff));
    p.blockAccessList = new Uint8Array(70 * 1024).fill(0xab);

    const full = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope).length;
    const blinded = ssz.gloas.SignedBlindedExecutionPayloadEnvelope.serialize(toSignedBlindedEnvelope(envelope)).length;

    expect(blinded).toBeLessThan(1500);
    expect(full - blinded).toBeGreaterThan(260_000);
  });

  it("blinded type round-trips through bytes", () => {
    const blinded = toSignedBlindedEnvelope(generateSignedExecutionPayloadEnvelope(8));
    const bytes = ssz.gloas.SignedBlindedExecutionPayloadEnvelope.serialize(blinded);
    const decoded = ssz.gloas.SignedBlindedExecutionPayloadEnvelope.deserialize(bytes);
    expect(ssz.gloas.SignedBlindedExecutionPayloadEnvelope.equals(blinded, decoded)).toBe(true);
  });

  it("blinded + bodies reconstruct the original byte-identically", () => {
    const envelope = generateSignedExecutionPayloadEnvelope(8);
    const rebuilt = signedBlindedEnvelopeToFull(persistedBlinded(envelope), bodiesOf(envelope));
    expect(ssz.gloas.SignedExecutionPayloadEnvelope.equals(rebuilt, envelope)).toBe(true);
  });

  it("reconstructs an empty-body envelope byte-identically", () => {
    const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue(); // empty tx/withdrawals/BAL
    const rebuilt = signedBlindedEnvelopeToFull(persistedBlinded(envelope), bodiesOf(envelope));
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
      signedBlindedEnvelopeToFull(persistedBlinded(envelope), {...bodiesOf(envelope), ...override});
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
