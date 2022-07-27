import {routes} from "@lodestar/api";

type OnEvent = (event: routes.events.BeaconEvent) => void;

/**
 * In-memory simple event emitter for `BeaconEvent`
 */
export class EventsServerApiMock implements routes.events.Api {
  private readonly onEventsByTopic = new Map<routes.events.EventType, Set<OnEvent>>();

  hasSubscriptions(): boolean {
    return this.onEventsByTopic.size > 0;
  }

  emit(event: routes.events.BeaconEvent): void {
    const onEvents = this.onEventsByTopic.get(event.type);
    if (onEvents) {
      for (const onEvent of onEvents) {
        onEvent(event);
      }
    }
  }

  eventstream(topics: routes.events.EventType[], signal: AbortSignal, onEvent: OnEvent): void {
    console.log("eventstream:", topics, signal, onEvent);
    for (const topic of typeof topics === "string" ? [topics] : topics) {
      let onEvents = this.onEventsByTopic.get(topic);
      if (!onEvents) {
        onEvents = new Set();
        this.onEventsByTopic.set(topic, onEvents);
      }

      onEvents.add(onEvent);
    }

    signal.addEventListener(
      "abort",
      () => {
        for (const topic of topics) {
          this.onEventsByTopic.get(topic)?.delete(onEvent);
        }
      },
      {once: true}
    );
  }
}
