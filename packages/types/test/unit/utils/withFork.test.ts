import {describe, expect, it} from "vitest";
import {ForkName, ForkSeq} from "@lodestar/params";
import {
  isWithForkPostAltair,
  isWithForkPostBellatrix,
  isWithForkPostCapella,
  isWithForkPostDeneb,
  isWithForkPostElectra,
  isWithForkPostFulu,
  isWithForkPostGloas,
  isWithForkPostHeze,
  ssz,
  withFork,
} from "../../../src/index.js";

describe("withFork", () => {
  it("pairs the value with its fork", () => {
    const value = ssz.phase0.Attestation.defaultValue();
    const att = withFork("SingleAttestation", ForkName.phase0, value);
    expect(att.fork).toBe(ForkName.phase0);
    expect(att.value).toBe(value);
  });

  const guards = [
    {guard: isWithForkPostAltair, from: ForkSeq.altair},
    {guard: isWithForkPostBellatrix, from: ForkSeq.bellatrix},
    {guard: isWithForkPostCapella, from: ForkSeq.capella},
    {guard: isWithForkPostDeneb, from: ForkSeq.deneb},
    {guard: isWithForkPostElectra, from: ForkSeq.electra},
    {guard: isWithForkPostFulu, from: ForkSeq.fulu},
    {guard: isWithForkPostGloas, from: ForkSeq.gloas},
    {guard: isWithForkPostHeze, from: ForkSeq.heze},
  ];

  for (const {guard, from} of guards) {
    it(`${guard.name} matches the forks at or after its boundary`, () => {
      for (const fork of Object.values(ForkName)) {
        const data = withFork("BeaconBlockHeader", fork, ssz.phase0.BeaconBlockHeader.defaultValue());
        expect(guard(data)).toBeWithMessage(ForkSeq[fork] >= from, `${guard.name}(${fork})`);
      }
    });
  }
});
