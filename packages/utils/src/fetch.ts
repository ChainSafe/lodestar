export type FetchError = Error & {
  cause: Error & {
    errno: string;
    code: string;
  };
};

export function isFetchError(error: unknown): error is FetchError {
  return (
    error instanceof Error &&
    (error as FetchError).cause instanceof Error &&
    (error as FetchError).cause.errno !== undefined &&
    (error as FetchError).cause.code !== undefined
  );
}

export function enhanceFetchErrors(error: unknown): void {
  if (isFetchError(error)) {
    // Override message with cause.message to get more detailed errors
    error.message = error.cause.message;
  }
}
