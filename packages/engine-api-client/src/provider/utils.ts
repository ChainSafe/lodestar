import {ErrorParseJson} from "./jsonRpcHttpClient.js";

export function isJsonRpcTruncatedError(error: Error): boolean {
  return (
    // Truncated responses usually get as 200 but since it's truncated the JSON will be invalid
    error instanceof ErrorParseJson ||
    // Otherwise guess Infura error message of too many events
    (error instanceof Error && error.message.includes("query returned more than 10000 results"))
  );
}
