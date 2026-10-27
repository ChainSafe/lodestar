import {describe, expectTypeOf, it} from "vitest";
import {ForkName, ForkPostElectra, ForkPreElectra} from "@lodestar/params";
import {
  SingleAttestation,
  WithFork,
  electra,
  isWithForkPostBellatrix,
  isWithForkPostElectra,
  phase0,
  ssz,
  withFork,
} from "../../src/index.js";

describe("WithFork", () => {
  it("infers both type parameters from the key and fork arguments", () => {
    const att = withFork("SingleAttestation", ForkName.phase0, ssz.phase0.Attestation.defaultValue());
    expectTypeOf(att).toEqualTypeOf<WithFork<"SingleAttestation", ForkName.phase0>>();
    expectTypeOf(att.value).toEqualTypeOf<phase0.Attestation>();
  });

  it("checks that the value matches the fork when the fork is known", () => {
    // @ts-expect-error electra single attestation is not a phase0 attestation
    withFork("SingleAttestation", ForkName.phase0, ssz.electra.SingleAttestation.defaultValue());
    // @ts-expect-error phase0 attestation is not an electra single attestation
    withFork("SingleAttestation", ForkName.electra, ssz.phase0.Attestation.defaultValue());
  });

  it("accepts a fork-union value when the fork is not statically known", () => {
    const att = withFork("SingleAttestation", {} as ForkName, {} as SingleAttestation);
    expectTypeOf(att).toEqualTypeOf<WithFork<"SingleAttestation">>();
  });

  it("widens a narrowed wrapper to the fork-union wrapper", () => {
    const att = withFork("SingleAttestation", ForkName.phase0, ssz.phase0.Attestation.defaultValue());
    expectTypeOf(att).toMatchTypeOf<WithFork<"SingleAttestation">>();
  });

  it("does not expose fork-specific fields before narrowing", () => {
    const att = {} as WithFork<"SingleAttestation">;
    // @ts-expect-error committeeIndex only exists post-electra
    att.value.committeeIndex;
    // @ts-expect-error aggregationBits only exists pre-electra
    att.value.aggregationBits;
  });

  it("narrows the value on both sides of a guard", () => {
    const att = {} as WithFork<"SingleAttestation">;
    if (isWithForkPostElectra(att)) {
      expectTypeOf(att.fork).toEqualTypeOf<ForkPostElectra>();
      expectTypeOf(att.value).toEqualTypeOf<SingleAttestation<ForkPostElectra>>();
      expectTypeOf(att.value.committeeIndex).toBeNumber();
    } else {
      expectTypeOf(att.fork).toEqualTypeOf<ForkPreElectra>();
      expectTypeOf(att.value).toEqualTypeOf<SingleAttestation<ForkPreElectra>>();
      expectTypeOf(att.value.aggregationBits).not.toBeAny();
    }
  });

  it("narrows the value on an equality check of the fork", () => {
    const att = {} as WithFork<"SingleAttestation">;
    if (att.fork === ForkName.electra) {
      expectTypeOf(att.value).toEqualTypeOf<electra.SingleAttestation>();
    }
  });

  it("only includes the forks that define the key", () => {
    expectTypeOf<WithFork<"ExecutionPayload">["fork"]>().toEqualTypeOf<
      Exclude<ForkName, ForkName.phase0 | ForkName.altair>
    >();
    // @ts-expect-error phase0 does not define ExecutionPayload
    withFork("ExecutionPayload", ForkName.phase0, {});
  });

  it("keeps guards usable from generic code", () => {
    function hasCommitteeBits<K extends "Attestation">(att: WithFork<K>): boolean {
      return isWithForkPostElectra(att) && att.value.committeeBits !== undefined;
    }
    expectTypeOf(hasCommitteeBits).returns.toBeBoolean();
    expectTypeOf(isWithForkPostBellatrix<"BeaconBlock">).guards.toEqualTypeOf<
      WithFork<"BeaconBlock", Exclude<ForkName, ForkName.phase0 | ForkName.altair>>
    >();
  });
});
