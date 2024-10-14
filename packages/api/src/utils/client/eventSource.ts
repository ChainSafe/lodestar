// This function switches between the native web implementation and a nodejs implemnetation
export async function getEventSource(): Promise<typeof EventSource> {
  if (globalThis.EventSource) {
    return EventSource;
  }
  return (await import("eventsource")).default as unknown as typeof EventSource;
}
