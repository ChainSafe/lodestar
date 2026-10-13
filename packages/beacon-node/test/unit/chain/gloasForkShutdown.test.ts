import {describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {requestShutdownAtGloasFork} from "../../../src/chain/gloasForkShutdown.js";
import {ClockEvent} from "../../../src/util/clock.js";
import {ClockStatic} from "../../utils/clock.js";

describe("requestShutdownAtGloasFork", () => {
  const gloasForkEpoch = 5;
  const config = createChainForkConfig({...chainConfig, GLOAS_FORK_EPOCH: gloasForkEpoch});

  it("requests shutdown once the clock reaches the Gloas fork epoch", () => {
    const clock = new ClockStatic(0);
    const processShutdownCallback = vi.fn();
    requestShutdownAtGloasFork(clock, config, processShutdownCallback);

    clock.emit(ClockEvent.epoch, gloasForkEpoch - 1);
    expect(processShutdownCallback).not.toHaveBeenCalled();

    clock.emit(ClockEvent.epoch, gloasForkEpoch);
    expect(processShutdownCallback).toHaveBeenCalledOnce();
    expect(processShutdownCallback.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((processShutdownCallback.mock.calls[0][0] as Error).message).toContain("Gloas");

    clock.emit(ClockEvent.epoch, gloasForkEpoch + 1);
    expect(processShutdownCallback).toHaveBeenCalledOnce();
  });

  it("never requests shutdown when Gloas is not scheduled", () => {
    const clock = new ClockStatic(0);
    const processShutdownCallback = vi.fn();
    requestShutdownAtGloasFork(
      clock,
      createChainForkConfig({...chainConfig, GLOAS_FORK_EPOCH: Infinity}),
      processShutdownCallback
    );

    clock.emit(ClockEvent.epoch, 1_000_000);
    expect(processShutdownCallback).not.toHaveBeenCalled();
  });
});
