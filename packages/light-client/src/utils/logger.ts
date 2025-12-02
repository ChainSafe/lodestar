/**
 * biome-ignore lint/suspicious/noExplicitAny: We need to use `any` type here
 * biome-ignore-all lint/suspicious/noConsole: The logger need to use the console
 * */
export type LogHandler = (message: string, context?: any, error?: Error) => void;

export type ILcLogger = {
  error: LogHandler;
  warn: LogHandler;
  info: LogHandler;
  debug: LogHandler;
};

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
