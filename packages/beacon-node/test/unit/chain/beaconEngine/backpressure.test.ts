import {beforeEach, describe, expect, it} from "vitest";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {MockedBeaconChain, getMockedBeaconChain, withBeaconEngineFacade} from "../../../mocks/mockedBeaconChain.js";

describe.each([false, true, undefined])("BeaconEngine backpressure (beaconEngineWorker=%s)", (beaconEngineWorker) => {
  let core: MockedBeaconChain;
  let chain: BeaconChain;

  beforeEach(() => {
    core = getMockedBeaconChain();
    core.opts.beaconEngineWorker = beaconEngineWorker;
    chain = withBeaconEngineFacade(core);
  });

  it("checks live regen capacity only in main-thread mode", () => {
    core.regen.canAcceptWork.mockReturnValue(false);
    expect(BeaconChain.prototype.beaconEngineRegenCanAcceptWork.call(chain)).toBe(beaconEngineWorker === true);

    core.regen.canAcceptWork.mockReturnValue(true);
    expect(BeaconChain.prototype.beaconEngineRegenCanAcceptWork.call(chain)).toBe(true);
    expect(core.regen.canAcceptWork).toHaveBeenCalledTimes(beaconEngineWorker ? 0 : 2);
    expect(core.bls.canAcceptWork).not.toHaveBeenCalled();
  });

  it("checks live BLS capacity only in main-thread mode", () => {
    core.bls.canAcceptWork.mockReturnValue(false);
    expect(BeaconChain.prototype.beaconEngineBlsThreadPoolCanAcceptWork.call(chain)).toBe(beaconEngineWorker === true);

    core.bls.canAcceptWork.mockReturnValue(true);
    expect(BeaconChain.prototype.beaconEngineBlsThreadPoolCanAcceptWork.call(chain)).toBe(true);
    expect(core.bls.canAcceptWork).toHaveBeenCalledTimes(beaconEngineWorker ? 0 : 2);
    expect(core.regen.canAcceptWork).not.toHaveBeenCalled();
  });
});
