// This function switches between the native web implementation and a nodejs implemnetation
export async function getEventSource(): Promise<typeof EventSource> {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (globalThis.EventSource) {
    return EventSource;
  } else {
    return ((await import("eventsource")).default as unknown) as typeof EventSource;
  }
}
