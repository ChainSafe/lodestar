// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LogHandler = (message: string, context?: any, error?: Error) => void;

export type ILcLogger = {
  error: LogHandler;
  warn: LogHandler;
  info: LogHandler;
  debug: LogHandler;
};

/* eslint-disable no-console */

/**
 * With `console` module and ignoring debug logs
 */
export function getLcLoggerConsole(opts?: {logDebug?: boolean}): ILcLogger {
  return {
    error: console.error,
    warn: console.warn,
    info: console.log,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    debug: opts?.logDebug ? console.log : () => {},
  };
}
