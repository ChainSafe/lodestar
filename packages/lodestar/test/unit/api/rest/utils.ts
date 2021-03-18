export function urlJoin(...args: string[]): string {
  return (
    args
      .join("/")
      .replace(/([^:]\/)\/+/g, "$1")
      // Remove duplicate slashes in the front
      .replace(/^(\/)+/, "/")
  );
}

export type ApiResponseBody = {data: [JSON]};
