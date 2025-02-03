import {Logger, transports} from "winston";
import {LEVEL, LogLevel, WinstonLogInfo} from "../interface.js";

export class ConsoleDynamicLevel extends transports.Console {
  private readonly levelByModule = new Map<string, LogLevel>();
  private readonly defaultLevel: LogLevel;

  // Define property from TransportStream that's not in the types
  private readonly levels!: Record<LogLevel, number>;
  private parent?: Logger;

  constructor(opts: {defaultLevel: LogLevel} & transports.ConsoleTransportOptions) {
    super(opts);

    this.defaultLevel = opts.defaultLevel;

    // Set level and parent to undefined so that underlying transport logs everything
    this.level = undefined;
  }

  setModuleLevel(module: string, level: LogLevel): void {
    this.levelByModule.set(module, level);
  }

  deleteModuleLevel(module: string): boolean {
    return this.levelByModule.delete(module);
  }

  // biome-ignore lint/correctness/noUndeclaredVariables: BufferEncoding is not been identified by the biomejs
  _write(info: WinstonLogInfo, enc: BufferEncoding, callback: (error?: Error | null | undefined) => void): void {
    const moduleLevel = this.levelByModule.get(info.module) ?? this.defaultLevel;

    // Min number is highest prio log level
    // levels = {error: 0, warn: 1, info: 2, ...}

    if (this.levels[moduleLevel] >= this.levels[info[LEVEL]]) {
      // Set level and parent to undefined so that underlying transport logs everything
      if (this.parent) {
        this.parent = undefined;
      }

      super._write(info, enc, callback);
    } else {
      callback(null);
    }
  }
}
