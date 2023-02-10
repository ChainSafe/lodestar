import {IChainForkConfig} from "@lodestar/config";
import {Api, BeaconEvent, routesData, getEventSerdes} from "../routes/events.js";
import {stringifyQuery} from "../../utils/client/format.js";
import {getEventSource} from "../../utils/client/eventSource.js";
import {HttpStatusCode} from "../../utils/client/httpStatusCode.js";

/**
 * REST HTTP client for events routes
 */
export function getClient(config: IChainForkConfig, baseUrl: string): Api {
  const eventSerdes = getEventSerdes(config);

  return {
    eventstream: async (topics, signal, onEvent) => {
      const query = stringifyQuery({topics});
      // TODO: Use a proper URL formatter
      const url = `${baseUrl}${routesData.eventstream.url}?${query}`;
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const EventSource = await getEventSource();
      const eventSource = new EventSource(url);

      try {
        await new Promise<void>((resolve, reject) => {
          for (const topic of topics) {
            eventSource.addEventListener(topic, ((event: MessageEvent) => {
              const message = eventSerdes.fromJson(topic, JSON.parse(event.data));
              onEvent({type: topic, message} as BeaconEvent);
            }) as EventListener);
          }

          // EventSource will try to reconnect always on all errors
          // `eventSource.onerror` events are informative but don't indicate the EventSource closed
          // The only way to abort the connection from the client is via eventSource.close()
          eventSource.onerror = function onerror(err) {
            const errEs = (err as unknown) as EventSourceError;
            // Consider 400 and 500 status errors unrecoverable, close the eventsource
            if (errEs.status === 400) {
              reject(Error(`400 Invalid topics: ${errEs.message}`));
            }
            if (errEs.status === 500) {
              reject(Error(`500 Internal Server Error: ${errEs.message}`));
            }

            // TODO: else log the error somewhere
            // console.log("eventstream client error", errEs);
          };

          // And abort resolve the promise so finally {} eventSource.close()
          signal.addEventListener("abort", () => resolve(), {once: true});
        });
      } finally {
        eventSource.close();
      }

      return {ok: true, response: undefined, status: HttpStatusCode.OK};
    },
  };
}

// https://github.com/EventSource/eventsource/blob/82e034389bd2c08d532c63172b8e858c5b185338/lib/eventsource.js#L143
type EventSourceError = {status: number; message: string};
