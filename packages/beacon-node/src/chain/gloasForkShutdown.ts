import {ChainForkConfig} from "@lodestar/config";
import {ProcessShutdownCallback} from "@lodestar/validator";
import {ClockEvent, IClock} from "../util/clock.js";

/**
 * The native state transition cannot process Gloas, so stop the node at the fork epoch
 * instead of failing every block from then on.
 */
export function requestShutdownAtGloasFork(
  clock: IClock,
  config: ChainForkConfig,
  processShutdownCallback: ProcessShutdownCallback
): void {
  if (config.GLOAS_FORK_EPOCH === Infinity) {
    return;
  }
  const onEpoch = (epoch: number): void => {
    if (epoch < config.GLOAS_FORK_EPOCH) {
      return;
    }
    clock.off(ClockEvent.epoch, onEpoch);
    processShutdownCallback(
      new Error(`--chain.nativeStateTransition does not support Gloas, which activated at epoch ${epoch}`)
    );
  };
  clock.on(ClockEvent.epoch, onEpoch);
}
