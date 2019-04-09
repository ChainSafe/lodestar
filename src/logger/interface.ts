export enum LogLevel {
    DEBUG = 'debug',
    INFO = 'info',
    WARN = 'warn',
    ERROR = 'error'
}

export abstract class AbstractLogger {

    public abstract info(message: string|object, context?: object): void;
    public abstract warn(message: string|object, context?: object): void;
    public abstract error(message: string|object, context?: object): void;
    public abstract debug(message: string|object, context?: object): void;

    /**
     * Should change which log levels are recorded.
     * @param level
     */
    public abstract setLogLevel(level: LogLevel): void;

}
