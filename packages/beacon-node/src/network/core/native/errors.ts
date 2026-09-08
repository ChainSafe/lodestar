import {LodestarError} from "@lodestar/utils";

export enum NativeNetworkErrorCode {
  CONFIGURATION = "NATIVE_NETWORK_CONFIGURATION",
  CAPACITY = "NATIVE_NETWORK_CAPACITY",
  CLOSED = "NATIVE_NETWORK_CLOSED",
  UNAVAILABLE = "NATIVE_NETWORK_UNAVAILABLE",
}

export class NativeNetworkError extends LodestarError<{code: NativeNetworkErrorCode; resource: string}> {
  constructor(type: {code: NativeNetworkErrorCode; resource: string}) {
    super(type, `${type.code}: ${type.resource}`);
  }
}

export function nativeInteger(value: number, resource: string, max = Number.MAX_SAFE_INTEGER, min = 0): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource});
  }
  return value;
}
