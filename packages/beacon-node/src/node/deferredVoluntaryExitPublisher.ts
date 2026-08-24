import {routes} from "@lodestar/api";
import {Logger} from "@lodestar/utils";
import {IBeaconChain} from "../chain/index.js";
import {RegenCaller} from "../chain/regen/index.js";
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
      const state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.publishDeferredVoluntaryExits);
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
