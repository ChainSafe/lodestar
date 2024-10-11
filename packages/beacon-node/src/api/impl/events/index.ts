import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {ApiModules} from "../types.js";

export function getEventsApi({
  chain,
}: Pick<ApiModules, "chain" | "config">): ApplicationMethods<routes.events.Endpoints> {
  return {
    async eventstream({topics, signal, onEvent}) {
      const onAbortFns: (() => void)[] = [];

      for (const topic of topics) {
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const handler = (data: any): void => {
          // TODO: What happens if this handler throws? Does it break the other chain.emitter listeners?

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
