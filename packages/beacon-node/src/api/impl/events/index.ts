import {routes, ServerApi} from "@lodestar/api";
import {ApiModules} from "../types.js";

export function getEventsApi({chain}: Pick<ApiModules, "chain" | "config">): ServerApi<routes.events.Api> {
  return {
    async eventstream(topics, signal, onEvent) {
      const onAbortFns: (() => void)[] = [];

      for (const topic of topics) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (data: any): void => {
          // TODO: What happens if this handler throws? Does it break the other chain.emitter listeners?

          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          onEvent({type: topic, message: data});
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
