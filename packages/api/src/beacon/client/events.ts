import {ChainForkConfig} from "@lodestar/config";
import {getEventSource} from "../../utils/client/eventSource.js";
import {stringifyQuery, urlJoin} from "../../utils/client/format.js";
import {ApiClientMethods} from "../../utils/client/method.js";
import {RouteDefinitionExtra} from "../../utils/client/request.js";
import {ApiResponse} from "../../utils/client/response.js";
import {BeaconEvent, Endpoints, getDefinitions, getEventSerdes} from "../routes/events.js";

export type ApiClient = ApiClientMethods<Endpoints>;

/**
 * REST HTTP client for events routes
 */
export function getClient(config: ChainForkConfig, baseUrl: string): ApiClient {
  const definitions = getDefinitions(config);
  const eventSerdes = getEventSerdes(config);

  return {
    eventstream: async ({
      topics,
      signal,
      onEvent,
      onError,
      onClose,
    }): Promise<ApiResponse<Endpoints["eventstream"]>> => {
      const query = stringifyQuery({topics});
      const url = `${urlJoin(baseUrl, definitions.eventstream.url)}?${query}`;
      const EventSource = await getEventSource();
      const eventSource = new EventSource(url);

      const close = (): void => {
        eventSource.close();
        onClose?.();
        signal.removeEventListener("abort", close);
      };
      signal.addEventListener("abort", close, {once: true});

      for (const topic of topics) {
        eventSource.addEventListener(topic, (event: MessageEvent) => {
          const message = eventSerdes.fromJson(topic, JSON.parse(event.data));
          onEvent({type: topic, message} as BeaconEvent);
        });
      }

      // EventSource will try to reconnect always on all errors
      // `eventSource.onerror` events are informative but don't indicate the EventSource closed
      // The only way to abort the connection from the client is via eventSource.close()
      eventSource.onerror = function onerror(err): void {
        const errEs = err as unknown as EventSourceError;

        // Ignore noisy errors due to beacon node being offline
        if (!/ECONNREFUSED|EAI_AGAIN/.test(errEs.message ?? "")) {
          // If there is no message it likely indicates that the server closed the connection
          onError?.(new Error(errEs.message ?? "Server closed connection"));
        }

        // Consider 400 and 500 status errors unrecoverable, close the eventsource
        if (errEs.status === 400 || errEs.status === 500) {
          close();
        }
      };

      return new ApiResponse(definitions.eventstream as RouteDefinitionExtra<Endpoints["eventstream"]>);
    },
  };
}

// https://github.com/EventSource/eventsource/blob/82e034389bd2c08d532c63172b8e858c5b185338/lib/eventsource.js#L143
type EventSourceError = {status?: number; message?: string};
