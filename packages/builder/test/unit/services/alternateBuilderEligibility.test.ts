import {describe, expect, it} from "vitest";
import {ForkName, PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toHex, toRootHex} from "@lodestar/utils";
import {
  type AlternatePayloadAttributesEvent,
  getAlternateBuilderBidLimit,
} from "../../../src/services/alternateBuilderEligibility.js";

function fixture() {
  const parentBlockRoot = Buffer.alloc(32, 1);
  const parentBlockHash = Buffer.alloc(32, 2);
  const dependentRoot = Buffer.alloc(32, 3);
  const builderPubkey = Buffer.alloc(48, 4);
  const data = ssz.gloas.SSEPayloadAttributes.defaultValue();
  data.proposalSlot = 123;
  data.proposerIndex = 456;
  data.parentBlockRoot = parentBlockRoot;
  data.parentBlockHash = parentBlockHash;
  data.payloadAttributes.parentBeaconBlockRoot = parentBlockRoot;
  const event: AlternatePayloadAttributesEvent = {
    version: ForkName.gloas,
    data,
    context: {
      role: "alternate",
      dependentRoot,
      builders: [
        {index: 7, pubkey: builderPubkey, version: PAYLOAD_BUILDER_VERSION, active: true, availableGwei: 1000},
      ],
    },
  };
  const expected = {
    slot: data.proposalSlot,
    proposerIndex: data.proposerIndex,
    parentBlockRoot: toRootHex(parentBlockRoot),
    parentBlockHash: toRootHex(parentBlockHash),
    dependentRoot: toRootHex(dependentRoot),
    builderIndex: 7,
    builderPubkey,
    unsettledGwei: 200,
  };
  return {event, expected};
}

describe("getAlternateBuilderBidLimit", () => {
  it("caps by branch availability after conservatively reserving local selections", () => {
    const {event, expected} = fixture();
    expect(getAlternateBuilderBidLimit(event, expected)).toBe(800);
    expected.unsettledGwei = 1500;
    expect(getAlternateBuilderBidLimit(event, expected)).toBeNull();
    expect(event.context.builders[0].availableGwei).toBe(1000);
  });

  it("skips zero capacity even if the head or another builder has more collateral", () => {
    const {event, expected} = fixture();
    event.context.builders[0].availableGwei = 0;
    event.context.builders.push({...event.context.builders[0], index: 8, availableGwei: 1_000_000});
    expect(getAlternateBuilderBidLimit(event, expected)).toBeNull();
  });

  it("skips zero-valued alternate offers when liabilities exactly consume branch capacity", () => {
    const {event, expected} = fixture();
    expected.unsettledGwei = event.context.builders[0].availableGwei;
    expect(getAlternateBuilderBidLimit(event, expected)).toBeNull();
    event.context.builders[0].availableGwei = 0;
    expected.unsettledGwei = 0;
    expect(getAlternateBuilderBidLimit(event, expected)).toBeNull();
  });

  it.each(["slot", "proposerIndex", "parentBlockRoot", "parentBlockHash", "dependentRoot"] as const)(
    "rejects metadata for a different %s",
    (field) => {
      const {event, expected} = fixture();
      const mismatch = {
        ...expected,
        [field]: typeof expected[field] === "number" ? 999 : toRootHex(Buffer.alloc(32, 9)),
      };
      expect(getAlternateBuilderBidLimit(event, mismatch)).toBeNull();
    }
  );

  it("rejects inconsistent parent-beacon roots in construction attributes", () => {
    const {event, expected} = fixture();
    event.data.payloadAttributes.parentBeaconBlockRoot = Buffer.alloc(32, 9);
    expect(getAlternateBuilderBidLimit(event, expected)).toBeNull();
  });

  it.each(["inactive", "wrongVersion", "wrongPubkey", "missingIndex"] as const)(
    "rejects branch identity with %s",
    (failure) => {
      const {event, expected} = fixture();
      const builder = event.context.builders[0];
      if (failure === "inactive") builder.active = false;
      if (failure === "wrongVersion") builder.version = PAYLOAD_BUILDER_VERSION + 1;
      if (failure === "wrongPubkey") builder.pubkey = Buffer.alloc(48, 9);
      if (failure === "missingIndex") builder.index++;
      expect(getAlternateBuilderBidLimit(event, expected)).toBeNull();
    }
  );

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects unsafe branch availability %s",
    (availableGwei) => {
      const {event, expected} = fixture();
      event.context.builders[0].availableGwei = availableGwei;
      expect(getAlternateBuilderBidLimit(event, expected)).toBeNull();
    }
  );

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects unsafe local liability %s",
    (unsettledGwei) => {
      const {event, expected} = fixture();
      expect(getAlternateBuilderBidLimit(event, {...expected, unsettledGwei})).toBeNull();
    }
  );

  it("accepts the largest exactly representable nonnegative balance", () => {
    const {event, expected} = fixture();
    event.context.builders[0].availableGwei = Number.MAX_SAFE_INTEGER;
    expect(getAlternateBuilderBidLimit(event, expected)).toBe(Number.MAX_SAFE_INTEGER - expected.unsettledGwei);
  });

  it("rejects ambiguous duplicate indices regardless of their ordering", () => {
    const {event, expected} = fixture();
    event.context.builders.push({...event.context.builders[0], availableGwei: 99_999});
    expect(getAlternateBuilderBidLimit(event, expected)).toBeNull();
    event.context.builders.reverse();
    expect(getAlternateBuilderBidLimit(event, expected)).toBeNull();
  });

  it("bounds metadata to sixteen configured identities and requires our identity", () => {
    const {event, expected} = fixture();
    const builder = event.context.builders[0];
    event.context.builders = Array.from({length: 16}, (_, index) => ({...builder, index}));
    expect(getAlternateBuilderBidLimit(event, expected)).toBe(800);
    event.context.builders.push({...builder, index: 16});
    expect(getAlternateBuilderBidLimit(event, expected)).toBeNull();
    event.context.builders = [];
    expect(getAlternateBuilderBidLimit(event, expected)).toBeNull();
  });

  it("rejects malformed fixed byte fields even if the caller repeats the value", () => {
    const {event, expected} = fixture();
    event.context.dependentRoot = Buffer.alloc(31, 3);
    expected.dependentRoot = toHex(event.context.dependentRoot);
    expect(getAlternateBuilderBidLimit(event, expected)).toBeNull();
    event.context.dependentRoot = Buffer.alloc(32, 3);
    expected.dependentRoot = toRootHex(event.context.dependentRoot);
    event.context.builders[0].pubkey = Buffer.alloc(47, 4);
    expected.builderPubkey = Buffer.alloc(47, 4);
    expect(getAlternateBuilderBidLimit(event, expected)).toBeNull();
  });
});
