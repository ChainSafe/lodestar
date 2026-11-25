import {describe, expect, it} from "vitest";
import {ssz} from "../../../src/index.js";

// Ensures the gloas-extended ExecutionRequests (and the ExecutionPayloadEnvelope that carries it)
// serializes to the snake_case JSON shape expected by Beacon-APIs / consensus-specs EIP-8282.
describe("gloas ExecutionRequests JSON shape", () => {
  it("BuilderDepositRequest encodes/decodes with snake_case keys", () => {
    const value = {
      pubkey: new Uint8Array(48).fill(0xaa),
      withdrawalCredentials: new Uint8Array(32).fill(0xbb),
      amount: 32_000_000_000,
      signature: new Uint8Array(96).fill(0xcc),
    };

    const json = ssz.gloas.BuilderDepositRequest.toJson(value) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(["amount", "pubkey", "signature", "withdrawal_credentials"]);

    const back = ssz.gloas.BuilderDepositRequest.fromJson(json);
    expect(back).toEqual(value);
  });

  it("BuilderExitRequest encodes/decodes with snake_case keys", () => {
    const value = {
      sourceAddress: new Uint8Array(20).fill(0xab),
      pubkey: new Uint8Array(48).fill(0xcd),
    };

    const json = ssz.gloas.BuilderExitRequest.toJson(value) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(["pubkey", "source_address"]);

    const back = ssz.gloas.BuilderExitRequest.fromJson(json);
    expect(back).toEqual(value);
  });

  it("ExecutionRequests carries builder_deposits / builder_exits alongside electra fields", () => {
    const value = ssz.gloas.ExecutionRequests.defaultValue();
    value.builderDeposits.push({
      pubkey: new Uint8Array(48).fill(0x01),
      withdrawalCredentials: new Uint8Array(32).fill(0x02),
      amount: 1_000_000_000,
      signature: new Uint8Array(96).fill(0x03),
    });
    value.builderExits.push({
      sourceAddress: new Uint8Array(20).fill(0x04),
      pubkey: new Uint8Array(48).fill(0x05),
    });

    const json = ssz.gloas.ExecutionRequests.toJson(value) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual([
      "builder_deposits",
      "builder_exits",
      "consolidations",
      "deposits",
      "withdrawals",
    ]);
    expect((json.builder_deposits as unknown[]).length).toBe(1);
    expect((json.builder_exits as unknown[]).length).toBe(1);

    const back = ssz.gloas.ExecutionRequests.fromJson(json);
    expect(back).toEqual(value);
    expect(ssz.gloas.ExecutionRequests.hashTreeRoot(back)).toEqual(ssz.gloas.ExecutionRequests.hashTreeRoot(value));
  });

  it("ExecutionPayloadEnvelope round-trips through JSON with builder requests populated", () => {
    const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
    envelope.executionRequests.builderDeposits.push({
      pubkey: new Uint8Array(48).fill(0xa1),
      withdrawalCredentials: new Uint8Array(32).fill(0xa2),
      amount: 32_000_000_000,
      signature: new Uint8Array(96).fill(0xa3),
    });
    envelope.executionRequests.builderExits.push({
      sourceAddress: new Uint8Array(20).fill(0xb1),
      pubkey: new Uint8Array(48).fill(0xb2),
    });

    const json = ssz.gloas.ExecutionPayloadEnvelope.toJson(envelope) as Record<string, unknown>;
    const requests = json.execution_requests as Record<string, unknown>;
    expect(requests).toBeDefined();
    expect((requests.builder_deposits as unknown[]).length).toBe(1);
    expect((requests.builder_exits as unknown[]).length).toBe(1);

    const back = ssz.gloas.ExecutionPayloadEnvelope.fromJson(json);
    expect(ssz.gloas.ExecutionPayloadEnvelope.hashTreeRoot(back)).toEqual(
      ssz.gloas.ExecutionPayloadEnvelope.hashTreeRoot(envelope)
    );
  });
});
