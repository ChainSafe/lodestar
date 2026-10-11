import {describe, expectTypeOf, it} from "vitest";
import {applyDeposit, processDeposit} from "../../src/block/processDeposit.js";
import {becomesNewEth1Data, processEth1Data} from "../../src/block/processEth1Data.js";
import {processEth1DataReset} from "../../src/epoch/processEth1DataReset.js";
import {
  BeaconStateAltair,
  BeaconStateBellatrix,
  BeaconStateCapella,
  BeaconStateDeneb,
  BeaconStateElectra,
  BeaconStateFulu,
  BeaconStateGloas,
  BeaconStateHeze,
  BeaconStatePhase0,
  BeaconStatePreHeze,
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
import {getEth1DepositCount} from "../../src/util/deposit.js";

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

  it("accepts every uncached pre-Heze state type", () => {
    expectTypeOf<BeaconStatePhase0>().toMatchTypeOf<BeaconStatePreHeze>();
    expectTypeOf<BeaconStateAltair>().toMatchTypeOf<BeaconStatePreHeze>();
    expectTypeOf<BeaconStateBellatrix>().toMatchTypeOf<BeaconStatePreHeze>();
    expectTypeOf<BeaconStateCapella>().toMatchTypeOf<BeaconStatePreHeze>();
    expectTypeOf<BeaconStateDeneb>().toMatchTypeOf<BeaconStatePreHeze>();
    expectTypeOf<BeaconStateElectra>().toMatchTypeOf<BeaconStatePreHeze>();
    expectTypeOf<BeaconStateFulu>().toMatchTypeOf<BeaconStatePreHeze>();
    expectTypeOf<BeaconStateGloas>().toMatchTypeOf<BeaconStatePreHeze>();
    expectTypeOf<CachedBeaconStatePreHeze>().toMatchTypeOf<BeaconStatePreHeze>();
  });

  it("rejects cached and uncached Heze states", () => {
    expectTypeOf<CachedBeaconStateHeze>().not.toMatchTypeOf<CachedBeaconStatePreHeze>();
    expectTypeOf<BeaconStateHeze>().not.toMatchTypeOf<BeaconStatePreHeze>();
    expectTypeOf<CachedBeaconStateHeze>().not.toMatchTypeOf<Parameters<typeof processDeposit>[1]>();
    expectTypeOf<CachedBeaconStateHeze>().not.toMatchTypeOf<Parameters<typeof processEth1Data>[0]>();
    expectTypeOf<BeaconStateHeze>().not.toMatchTypeOf<Parameters<typeof becomesNewEth1Data>[0]>();
    expectTypeOf<CachedBeaconStateHeze>().not.toMatchTypeOf<Parameters<typeof processEth1DataReset>[0]>();
    expectTypeOf<CachedBeaconStateHeze>().not.toMatchTypeOf<Parameters<typeof getEth1DepositCount>[0]>();
  });

  it("restricts legacy deposit processing without restricting deposit application", () => {
    expectTypeOf(processDeposit).parameter(1).toEqualTypeOf<CachedBeaconStatePreHeze>();
    expectTypeOf(processEth1Data).parameter(0).toEqualTypeOf<CachedBeaconStatePreHeze>();
    expectTypeOf(becomesNewEth1Data).parameter(0).toEqualTypeOf<BeaconStatePreHeze>();
    expectTypeOf(processEth1DataReset).parameter(0).toEqualTypeOf<CachedBeaconStatePreHeze>();
    expectTypeOf(getEth1DepositCount).parameter(0).toEqualTypeOf<CachedBeaconStatePreHeze>();
    expectTypeOf(applyDeposit).parameter(1).toEqualTypeOf<CachedBeaconStateAllForks>();
    expectTypeOf<CachedBeaconStateHeze>().toMatchTypeOf<Parameters<typeof applyDeposit>[1]>();
  });
});
