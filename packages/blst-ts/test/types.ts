import * as bindings from "../import";

export type BufferLike = string | bindings.BlstBuffer | bindings.Serializable;
export enum TestSyncOrAsync {
  SYNC = 0,
  ASYNC = 1,
}
export enum TestPhase {
  SETUP = 0,
  EXECUTION = 1,
  VALUE_RETURN = 2,
}
export enum TestCase {
  NORMAL_EXECUTION = -1,
  SET_ERROR = 0,
  THROW_ERROR = 1,
  UINT_8_ARRAY_ARG = 2,
  UINT_8_ARRAY_ARG_ARRAY = 3,
  PUBLIC_KEY_ARG = 4,
  PUBLIC_KEY_ARG_ARRAY = 5,
  SIGNATURE_ARG = 6,
  SIGNATURE_ARG_ARRAY = 7,
  SIGNATURE_SET = 8,
  SIGNATURE_SET_ARRAY = 9,
}
export declare function TestFunction(
  syncOrAsync: TestSyncOrAsync.SYNC,
  testPhase: TestPhase,
  testCase: TestCase,
  testObj?: any
): string;
export declare function TestFunction(
  syncOrAsync: TestSyncOrAsync.SYNC,
  testPhase: TestPhase,
  testCase: TestCase,
  testObj?: any
): Promise<string>;
export declare function TestFunction(
  syncOrAsync: TestSyncOrAsync,
  testPhase: TestPhase,
  testCase: TestCase,
  testObj?: any
): string | Promise<string>;
export type BindingsWithTestRig = typeof bindings & {runTest: typeof TestFunction};
export interface NapiTestSet {
  msg: Uint8Array;
  secretKey: bindings.SecretKey;
  publicKey: bindings.PublicKey;
  signature: bindings.Signature;
}
