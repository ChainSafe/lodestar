import {ChainForkConfig} from "@lodestar/config";
import {BeaconEvent, getEventSerdes, Endpoints, definitions} from "../routes/events.js";
import {getEventSource} from "../../utils/client/eventSource.js";
import {IHttpClient} from "../../utils/client/httpClient.js";
import {ApiClientMethods} from "../../utils/client/method.js";
import {compileRouteUrlFormater} from "../../utils/urlFormat.js";

/**
 * REST HTTP client for events routes
 */
export function getClient(config: ChainForkConfig, client: IHttpClient): ApiClientMethods<Endpoints> {
  const eventSerdes = getEventSerdes(config);

  const urlFormatter = compileRouteUrlFormater(definitions.eventstream.url);
  const eventstreamDefinitionExtended = {
    ...definitions.eventstream,
    urlFormatter,
    operationId: "eventstream",
  };

  return {
    eventstream: async (args, init) => {
      const fetch = async (input: RequestInfo | URL): Promise<Response> => {
        const url = input instanceof Request ? input.url : input;
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const EventSource = await getEventSource();
        const eventSource = new EventSource(url);

        const {topics, signal, onEvent, onError, onClose} = args;

        const close = (): void => {
          eventSource.close();
          onClose?.();
          signal.removeEventListener("abort", close);
        };
        signal.addEventListener("abort", close, {once: true});

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
          const errEs = err as unknown as EventSourceError;
          onError?.(errEs);
          // Consider 400 and 500 status errors unrecoverable, close the eventsource
          if (errEs.status === 400 || errEs.status === 500) {
            close();
          }
          // TODO: else log the error somewhere
          // console.log("eventstream client error", errEs);
        };

        return new Response();
      };

      return client.request(eventstreamDefinitionExtended, args, init ?? {}, fetch);
    },
  };
}

// https://github.com/EventSource/eventsource/blob/82e034389bd2c08d532c63172b8e858c5b185338/lib/eventsource.js#L143
type EventSourceError = {status: number; message: string};
