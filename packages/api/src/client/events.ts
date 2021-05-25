import EventSource from "eventsource";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Api, BeaconEvent, routesData, getEventSerdes} from "../routes/events";

/**
 * REST HTTP client for events routes
 */
export function getClient(config: IBeaconConfig, baseUrl: string): Api {
  const eventSerdes = getEventSerdes(config);

  return {
    eventstream: (topics, signal, onEvent) => {
      const query = topics.map((topic) => `topics=${topic}`).join("&");
      // TODO: Use a proper URL formatter
      const url = baseUrl + `${baseUrl}${routesData.eventstream.url}?${query}`;
      const eventSource = new EventSource(url);

      for (const topic of topics) {
        eventSource.addEventListener(topic, ((event: MessageEvent) => {
          const message = eventSerdes.fromJson(topic, JSON.parse(event.data));
          onEvent({type: topic, message} as BeaconEvent);
        }) as EventListener);
      }

      signal.addEventListener("abort", () => eventSource.close(), {once: true});
    },
  };
}
