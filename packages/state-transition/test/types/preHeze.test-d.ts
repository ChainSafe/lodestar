import {describe, expectTypeOf, it} from "vitest";
import {applyDeposit, processDeposit} from "../../src/block/processDeposit.js";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateAltair,
  CachedBeaconStateBellatrix,
  CachedBeaconStateCapella,
  CachedBeaconStateDeneb,
  CachedBeaconStateElectra,
  CachedBeaconStateFulu,
  CachedBeaconStateGloas,
  CachedBeaconStateHeze,
  CachedBeaconStatePhase0,
  CachedBeaconStatePreHeze,
} from "../../src/index.js";

describe("CachedBeaconStatePreHeze", () => {
  it("accepts every pre-Heze state type", () => {
    expectTypeOf<CachedBeaconStatePhase0>().toMatchTypeOf<CachedBeaconStatePreHeze>();
    expectTypeOf<CachedBeaconStateAltair>().toMatchTypeOf<CachedBeaconStatePreHeze>();
    expectTypeOf<CachedBeaconStateBellatrix>().toMatchTypeOf<CachedBeaconStatePreHeze>();
    expectTypeOf<CachedBeaconStateCapella>().toMatchTypeOf<CachedBeaconStatePreHeze>();
    expectTypeOf<CachedBeaconStateDeneb>().toMatchTypeOf<CachedBeaconStatePreHeze>();
    expectTypeOf<CachedBeaconStateElectra>().toMatchTypeOf<CachedBeaconStatePreHeze>();
    expectTypeOf<CachedBeaconStateFulu>().toMatchTypeOf<CachedBeaconStatePreHeze>();
    expectTypeOf<CachedBeaconStateGloas>().toMatchTypeOf<CachedBeaconStatePreHeze>();
  });

  it("rejects a Heze state", () => {
    expectTypeOf<CachedBeaconStateHeze>().not.toMatchTypeOf<CachedBeaconStatePreHeze>();
  });

  it("restricts legacy deposit processing without restricting deposit application", () => {
    expectTypeOf(processDeposit).parameter(1).toEqualTypeOf<CachedBeaconStatePreHeze>();
    expectTypeOf(applyDeposit).parameter(1).toEqualTypeOf<CachedBeaconStateAllForks>();
  });
});
