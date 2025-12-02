import {Logger} from "@lodestar/utils";

export function getEmptyLogger(): Logger {
  return {
    error: function error(): void {
      // Do nothing
    },
    warn: function warn(): void {
      // Do nothing
    },
    info: function info(): void {
      // Do nothing
    },
    verbose: function verbose(): void {
      // Do nothing
    },
    debug: function debug(): void {
      // Do nothing
    },
  };
}
