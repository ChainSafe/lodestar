import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {ApiModules} from "../types.js";

export function getEventsApi({
  chain,
  logger,
}: Pick<ApiModules, "chain" | "config" | "logger">): ApplicationMethods<routes.events.Endpoints> {
  return {
    async eventstream({topics, signal, onEvent}) {
      const onAbortFns: (() => void)[] = [];

      for (const topic of topics) {
        // biome-ignore lint/suspicious/noExplicitAny: We need to use `any` type here
        const handler = (data: any): void => {
          try {
            // TS only relates `{type, message}` to the `BeaconEvent` discriminated union while
            // `EventType` stays within its ~25-member cap; without the cast, adding events trips TS2345.
            onEvent({type: topic, message: data} as routes.events.BeaconEvent);
          } catch (e) {
            // `chain.emitter` emits synchronously, a throwing listener would propagate the error to
            // whoever emitted the event, e.g. a gossip handler, and skip the remaining listeners.
            // A single misbehaving event or client must not affect the node or other subscribers.
            logger.warn("Error sending event to client", {topic}, e as Error);
          }
        };

        chain.emitter.on(topic, handler);
        onAbortFns.push(() => chain.emitter.off(topic, handler));
      }

      signal.addEventListener(
        "abort",
        () => {
          for (const abortFn of onAbortFns) abortFn();
        },
        {once: true}
      );
    },
  };
}
