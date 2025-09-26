// This file is maintained for backward compatibility but is no longer used with pino
import {LoggerOptions} from "../interface.js";

// Dummy Format type for backward compatibility
// biome-ignore lint/suspicious/noExplicitAny: Placeholder for backward compatibility
type Format = any;

export function getFormat(_opts: LoggerOptions): Format {
  // This function is no longer used with pino but maintained for compatibility
  return null;
}
