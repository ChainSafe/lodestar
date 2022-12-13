import bls from "@chainsafe/bls";
import {CoordType} from "@chainsafe/bls/types";
import {InputType} from "@lodestar/spec-test-util";
import {toHexString} from "@lodestar/utils";
import {fromHexString} from "@chainsafe/ssz";
import {TestRunnerFn} from "../utils/types.js";

/* eslint-disable @typescript-eslint/naming-convention */

const testFnByType: Record<string, (data: any) => any> = {
  aggregate,
  aggregate_verify,
  eth_aggregate_pubkeys,
  eth_fast_aggregate_verify,
  fast_aggregate_verify,
  sign,
  verify,
};

const G2_POINT_AT_INFINITY =
  "0xc00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
const G1_POINT_AT_INFINITY =
  "0xc00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

export const blsTestRunner: TestRunnerFn<BlsTestCase, unknown> = (fork, testName) => {
  return {
    testFunction: ({data}) => {
      const testFn = testFnByType[testName];
      if (testFn === undefined) {
        throw Error(`Unknown bls test ${testName}`);
      }

      try {
        return testFn(data.input) as unknown;
      } catch (e) {
        const {message} = e as Error;
        if (message.includes("BLST_ERROR") || message === "EMPTY_AGGREGATE_ARRAY" || message === "ZERO_SECRET_KEY") {
          return null;
        } else {
          throw e;
        }
      }
    },
    options: {
      inputTypes: {data: InputType.YAML},
      getExpected: (testCase) => testCase.data.output,
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/general/index.test.ts
    },
  };
};

type BlsTestCase = {
  meta?: any;
  data: {
    input: unknown;
    output: unknown;
  };
};

/**
 * ```
 * input: List[BLS Signature] -- list of input BLS signatures
 * output: BLS Signature -- expected output, single BLS signature or empty.
 * ```
 */
function aggregate(input: string[]): string {
  const pks = input.map((pkHex) => bls.Signature.fromHex(pkHex));
  const agg = bls.Signature.aggregate(pks);
  return agg.toHex();
}

/**
 * ```
 * input:
 *   pubkeys: List[BLS Pubkey] -- the pubkeys
 *   messages: List[bytes32] -- the messages
 *   signature: BLS Signature -- the signature to verify against pubkeys and messages
 * output: bool  --  true (VALID) or false (INVALID)
 * ```
 */
function aggregate_verify(input: {pubkeys: string[]; messages: string[]; signature: string}): boolean {
  const {pubkeys, messages, signature} = input;
  return bls.verifyMultiple(pubkeys.map(fromHexString), messages.map(fromHexString), fromHexString(signature));
}

/**
 * ```
 * input: List[BLS Signature] -- list of input BLS signatures
 * output: BLS Signature -- expected output, single BLS signature or empty.
 * ```
 */
function eth_aggregate_pubkeys(input: string[]): string | null {
  // Don't add this checks in the source as beacon nodes check the pubkeys for inf when onboarding
  for (const pk of input) {
    if (pk === G1_POINT_AT_INFINITY) return null;
  }

  const agg = bls.aggregatePublicKeys(input.map((hex) => fromHexString(hex)));
  return toHexString(agg);
}

/**
 * ```
 * input:
 *   pubkeys: List[BLS Pubkey] -- list of input BLS pubkeys
 *   message: bytes32 -- the message
 *   signature: BLS Signature -- the signature to verify against pubkeys and message
 * output: bool  --  true (VALID) or false (INVALID)
 * ```
 */
function eth_fast_aggregate_verify(input: {pubkeys: string[]; message: string; signature: string}): boolean {
  const {pubkeys, message, signature} = input;

  if (pubkeys.length === 0 && signature === G2_POINT_AT_INFINITY) {
    return true;
  }

  // Don't add this checks in the source as beacon nodes check the pubkeys for inf when onboarding
  for (const pk of pubkeys) {
    if (pk === G1_POINT_AT_INFINITY) return false;
  }

  return bls.verifyAggregate(
    pubkeys.map((hex) => fromHexString(hex)),
    fromHexString(message),
    fromHexString(signature)
  );
}

/**
 * ```
 * input:
 *   pubkeys: List[BLS Pubkey] -- list of input BLS pubkeys
 *   message: bytes32 -- the message
 *   signature: BLS Signature -- the signature to verify against pubkeys and message
 * output: bool  --  true (VALID) or false (INVALID)
 * ```
 */
function fast_aggregate_verify(input: {pubkeys: string[]; message: string; signature: string}): boolean | null {
  const {pubkeys, message, signature} = input;
  try {
    return bls.Signature.fromBytes(fromHexString(signature), undefined, true).verifyAggregate(
      pubkeys.map((hex) => bls.PublicKey.fromBytes(fromHexString(hex), CoordType.jacobian, true)),
      fromHexString(message)
    );
  } catch (e) {
    return false;
  }
}

/**
 * input:
 *   privkey: bytes32 -- the private key used for signing
 *   message: bytes32 -- input message to sign (a hash)
 * output: BLS Signature -- expected output, single BLS signature or empty.
 */
function sign(input: {privkey: string; message: string}): string | null {
  const {privkey, message} = input;
  const signature = bls.sign(fromHexString(privkey), fromHexString(message));
  return toHexString(signature);
}

/**
 * input:
 *   pubkey: bytes48 -- the pubkey
 *   message: bytes32 -- the message
 *   signature: bytes96 -- the signature to verify against pubkey and message
 * output: bool  -- VALID or INVALID
 */
function verify(input: {pubkey: string; message: string; signature: string}): boolean {
  const {pubkey, message, signature} = input;
  return bls.verify(fromHexString(pubkey), fromHexString(message), fromHexString(signature));
}
