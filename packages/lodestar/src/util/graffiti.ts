import {GRAFFITI_SIZE} from "../constants";

/**
 * Parses a graffiti ASCII string and returns a 32 bytes buffer right padded with zeros
 * @param graffiti
 */
export function toGraffitiBuffer(graffiti: string): Buffer {
  return Buffer.concat([
    Buffer.from(graffiti, "ascii"),
    Buffer.alloc(GRAFFITI_SIZE, 0)
  ], GRAFFITI_SIZE);
}