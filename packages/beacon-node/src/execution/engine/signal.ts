/**
 * Runs `fn` with a signal that aborts with either the signal of the client or the signal of a single request.
 * Not AbortSignal.any(), Node retains every composite until the long-lived client signal aborts.
 */
export async function withRequestSignal<T>(
  clientSignal: AbortSignal | undefined,
  requestSignal: AbortSignal | undefined,
  fn: (signal: AbortSignal | undefined) => Promise<T>
): Promise<T> {
  if (requestSignal === undefined) {
    return fn(clientSignal);
  }

  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  clientSignal?.addEventListener("abort", onAbort, {once: true});
  requestSignal.addEventListener("abort", onAbort, {once: true});
  if (clientSignal?.aborted || requestSignal.aborted) {
    controller.abort();
  }

  try {
    return await fn(controller.signal);
  } finally {
    clientSignal?.removeEventListener("abort", onAbort);
    requestSignal.removeEventListener("abort", onAbort);
  }
}
