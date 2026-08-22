import {EventEmitter} from "node:events";
import {ApiClient, routes} from "@lodestar/api";
import {Logger} from "@lodestar/utils";

type EventType = routes.events.EventType;
type EventData = routes.events.EventData;

/** Events the builder subscribes to on the beacon node */
export const BUILDER_EVENT_TOPICS = [
  routes.events.EventType.payloadAttributes,
  routes.events.EventType.proposerPreferences,
  routes.events.EventType.block,
] as const;

export type BuilderEventType = (typeof BUILDER_EVENT_TOPICS)[number];

/**
 * Subscribes to the beacon node event stream and re-emits events locally.
 * The underlying EventSource reconnects on its own, subscribing once is enough.
 */
export class ChainEvents {
  private readonly emitter = new EventEmitter();

  constructor(
    private readonly api: ApiClient,
    private readonly logger: Logger
  ) {}

  start(signal: AbortSignal): void {
    this.api.events
      .eventstream({
        topics: [...BUILDER_EVENT_TOPICS],
        signal,
        onEvent: (event) => {
          this.emitter.emit(event.type, event.message);
        },
        onError: (e) => {
          this.logger.error("Failed to receive beacon node event", {}, e);
        },
        onClose: () => {
          this.logger.verbose("Closed beacon node event stream");
        },
      })
      .catch((e) => this.logger.error("Failed to subscribe to beacon node events", {}, e));
  }

  on<K extends BuilderEventType>(type: K, handler: (data: EventData[K]) => void): void {
    this.emitter.on(type, handler);
  }

  /** For tests and internal dispatch */
  emit<K extends EventType>(type: K, data: EventData[K]): void {
    this.emitter.emit(type, data);
  }
}
