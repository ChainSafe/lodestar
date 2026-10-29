import {beforeEach, describe, expect, it} from "vitest";
import {BeaconEngineMode} from "../../../../src/chain/beaconEngine/options.js";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {MockedBeaconChain, getMockedBeaconChain, withBeaconEngineFacade} from "../../../mocks/mockedBeaconChain.js";

describe.each([BeaconEngineMode.MainThread, BeaconEngineMode.Worker, undefined])(
  "BeaconEngine backpressure (beaconEngineMode=%s)",
  (beaconEngineMode) => {
    let core: MockedBeaconChain;
    let chain: BeaconChain;

    beforeEach(() => {
      core = getMockedBeaconChain();
      core.opts.beaconEngineMode = beaconEngineMode;
      chain = withBeaconEngineFacade(core);
    });

    it("checks live regen capacity only in main-thread mode", () => {
      core.regen.canAcceptWork.mockReturnValue(false);
      expect(BeaconChain.prototype.beaconEngineRegenCanAcceptWork.call(chain)).toBe(
        (beaconEngineMode ?? BeaconEngineMode.MainThread) !== BeaconEngineMode.MainThread
      );

      core.regen.canAcceptWork.mockReturnValue(true);
      expect(BeaconChain.prototype.beaconEngineRegenCanAcceptWork.call(chain)).toBe(true);
      expect(core.regen.canAcceptWork).toHaveBeenCalledTimes(
        (beaconEngineMode ?? BeaconEngineMode.MainThread) !== BeaconEngineMode.MainThread ? 0 : 2
      );
      expect(core.bls.canAcceptWork).not.toHaveBeenCalled();
    });

    it("checks live BLS capacity only in main-thread mode", () => {
      core.bls.canAcceptWork.mockReturnValue(false);
      expect(BeaconChain.prototype.beaconEngineBlsThreadPoolCanAcceptWork.call(chain)).toBe(
        (beaconEngineMode ?? BeaconEngineMode.MainThread) !== BeaconEngineMode.MainThread
      );

      core.bls.canAcceptWork.mockReturnValue(true);
      expect(BeaconChain.prototype.beaconEngineBlsThreadPoolCanAcceptWork.call(chain)).toBe(true);
      expect(core.bls.canAcceptWork).toHaveBeenCalledTimes(
        (beaconEngineMode ?? BeaconEngineMode.MainThread) !== BeaconEngineMode.MainThread ? 0 : 2
      );
      expect(core.regen.canAcceptWork).not.toHaveBeenCalled();
    });
  }
);
