// This file is maintained for backward compatibility but is no longer used with pino
import {LogLevel} from "../interface.js";

export class ConsoleDynamicLevel {
  private readonly levelByModule = new Map<string, LogLevel>();

  setModuleLevel(module: string, level: LogLevel): void {
    this.levelByModule.set(module, level);
  }

  deleteModuleLevel(module: string): boolean {
    return this.levelByModule.delete(module);
  }
}
