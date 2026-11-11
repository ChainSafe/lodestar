import {createHash} from "node:crypto";

export function deterministicBenchmarkSeed(domain: string): Uint8Array {
  return createHash("sha256").update(domain).digest();
}
