// biome-ignore lint/suspicious/noExplicitAny: <explanation>
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
export function getConsoleLogger(opts?: {logDebug?: boolean}): ILcLogger {
  return {
    error: console.error,
    warn: console.warn,
    info: console.log,
    debug: opts?.logDebug ? console.log : () => {},
  };
}

/**
 * @deprecated - Use `getConsoleLogger` instead.
 */
export const getLcLoggerConsole = getConsoleLogger;
