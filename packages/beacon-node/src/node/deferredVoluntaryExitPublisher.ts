import {routes} from "@lodestar/api";
import {Logger} from "@lodestar/utils";
import {IBeaconChain} from "../chain/index.js";
import {INetwork} from "../network/index.js";
import {ClockEvent} from "../util/clock.js";

/**
 * On every epoch, drain the deferred voluntary exit pool and publish the exits that have become
 * processable. Lives at the node layer rather than inside `BeaconChain` because publishing needs
 * `network`, which the chain does not (and should not) depend on.
 */
export function startDeferredVoluntaryExitPublisher({
  chain,
  network,
  logger,
  signal,
}: {
  chain: IBeaconChain;
  network: INetwork;
  logger: Logger;
  signal: AbortSignal;
}): void {
  const onEpoch = async (): Promise<void> => {
    try {
      // Use the cached head state directly rather than getHeadStateAtCurrentEpoch, which would regen
      // the head forward to the current epoch. At init from a stale db-finalized state that regen can
      // be many epoch transitions. The head state is fine here: this is a best-effort drain that
      // re-runs every epoch, so a just-processable exit is republished next tick.
      const state = chain.getHeadState();
      const exits = chain.deferredVoluntaryExitPool.drainProcessableExits(state);
      for (const exit of exits) {
        try {
          chain.opPool.insertVoluntaryExit(exit);
          chain.emitter.emit(routes.events.EventType.voluntaryExit, exit);
          await network.publishVoluntaryExit(exit);
          logger.info("Voluntary exit successfully published for validator", {
            validatorIndex: exit.message.validatorIndex,
          });
        } catch (e) {
          logger.warn(
            "Failed to publish deferred voluntary exit",
            {validatorIndex: exit.message.validatorIndex},
            e as Error
          );
        }
      }
    } catch (e) {
      logger.warn("Failed to drain deferred voluntary exit pool", {}, e as Error);
    }
  };

  chain.clock.addListener(ClockEvent.epoch, onEpoch);
  signal.addEventListener("abort", () => chain.clock.removeListener(ClockEvent.epoch, onEpoch), {once: true});
}
