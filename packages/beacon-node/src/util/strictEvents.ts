/**
 * Simplified version of `strict-event-emitter-types` where each event only emits one argument
 */
export type StrictEventEmitterSingleArg<EventData> = {
  on<K extends keyof EventData>(event: K, listener: (data: EventData[K]) => void): void;
  off<K extends keyof EventData>(event: K, listener: (data: EventData[K]) => void): void;
  emit<K extends keyof EventData>(event: K, data: EventData[K]): void;
};
