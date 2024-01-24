import {
  CoordType,
  PublicKey,
  SecretKey,
  Signature,
  aggregateSignatures,
  verify as VERIFY,
  aggregateVerify,
  fastAggregateVerify,
  aggregatePublicKeys,
} from "@chainsafe/blst-ts";
import {InputType} from "@lodestar/spec-test-util";
import {fromHex} from "@lodestar/utils";
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
        if (
          message.includes("BLST_ERROR")
          // || message === "EMPTY_AGGREGATE_ARRAY"
          // || message === "ZERO_SECRET_KEY"
        ) {
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
  const pks = input.map((pkHex) => Signature.deserialize(fromHex(pkHex)));
  const agg = aggregateSignatures(pks);
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
  return aggregateVerify(messages.map(fromHex), pubkeys.map(fromHex), fromHex(signature));
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

  return aggregatePublicKeys(input.map((hex) => fromHex(hex))).toHex();
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

  return fastAggregateVerify(
    fromHex(message),
    pubkeys.map((hex) => fromHex(hex)),
    fromHex(signature)
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
    const sig = Signature.deserialize(fromHex(signature));
    const pks = pubkeys.map((hex) => {
      const pk = PublicKey.deserialize(fromHex(hex), CoordType.jacobian);
      pk.keyValidate();
      return pk;
    });
    sig.sigValidate();
    return fastAggregateVerify(fromHex(message), pks, sig);
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
  const sk = SecretKey.deserialize(fromHex(privkey));
  return sk.sign(fromHex(message)).toHex();
}

/**
 * input:
 *   pubkey: bytes48 -- the pubkey
 *   message: bytes32 -- the message
 *   signature: bytes96 -- the signature to verify against pubkey and message
 * output: bool  -- VALID or INVALID
 */
function verify(input: {pubkey: string; message: string; signature: string}): boolean {
  try {
    const {pubkey, message, signature} = input;
    return VERIFY(fromHex(message), fromHex(pubkey), fromHex(signature));
  } catch {
    return false;
  }
}
