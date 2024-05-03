import {Lightclient} from "@lodestar/light-client";

export function assertLightClient(client?: Lightclient): asserts client is Lightclient {
  if (!client) {
    throw new Error("Light client is not initialized yet.");
  }
}

export function isTruthy<T = unknown>(value: T): value is Exclude<T, undefined | null> {
  return value !== undefined && value !== null && value !== false;
}
