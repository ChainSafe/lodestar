export interface ILogger {
  error(message: string|object, context?: object): void;
  warn(message: string|object, context?: object): void;
  info(message: string|object, context?: object): void;
  verbose(message: string|object, context?: object): void;
  debug(message: string|object, context?: object): void;
  silly(message: string|object, context?: object): void;
  important(message: string|object, context?: object): void;
}