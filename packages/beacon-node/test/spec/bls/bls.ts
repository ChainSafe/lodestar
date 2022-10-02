import bls from "@chainsafe/bls";
import {CoordType} from "@chainsafe/bls/types";
import {toHexString} from "@lodestar/utils";
import {fromHexString} from "@chainsafe/ssz";

/* eslint-disable @typescript-eslint/naming-convention */

export const testFnByType: Record<string, "skip" | ((data: any) => any)> = {
  aggregate_verify,
  aggregate,
  fast_aggregate_verify,
  batch_verify,
  sign,
  verify,
  // @chainsafe/bls does not expose functionality to run show low level function.
  // Ok to skip since this is indirectly tested on the other functions.
  hash_to_G2: "skip",
  deserialization_G1,
  deserialization_G2,
};

/**
 * https://github.com/ethereum/bls12-381-tests/blob/master/formats/aggregate_verify.md
 * ```
 * input:
 *   pubkeys: List[bytes48] -- the pubkeys
 *   messages: List[bytes32] -- the messages
 *   signature: bytes96 -- the signature to verify against pubkeys and messages
 * output: bool  -- VALID or INVALID
 * ```
 */
function aggregate_verify(input: {pubkeys: string[]; messages: string[]; signature: string}): boolean {
  const {pubkeys, messages, signature} = input;
  return bls.verifyMultiple(pubkeys.map(fromHexString), messages.map(fromHexString), fromHexString(signature));
}

/**
 * ```
 * input: List[BLS Signature] -- list of input BLS signatures
 * output: BLS Signature -- expected output, single BLS signature or `null`.
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
 *   pubkeys: List[bytes48] -- the pubkey
 *   message: bytes32 -- the message
 *   signature: bytes96 -- the signature to verify against pubkeys and message
 * output: bool  -- VALID or INVALID
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
 * ```
 * input:
 *   pubkeys: List[bytes48] -- the pubkeys
 *   messages: List[bytes32] -- the messages
 *   signatures: List[bytes96] -- the signatures to verify against pubkeys and messages
 * output: bool  -- VALID or INVALID
 * ```
 * https://github.com/ethereum/bls12-381-tests/blob/master/formats/batch_verify.md
 */
function batch_verify(input: {pubkeys: string[]; messages: string[]; signatures: string[]}): boolean | null {
  const {pubkeys, messages, signatures} = input;
  try {
    return bls.Signature.verifyMultipleSignatures(
      pubkeys.map((pubkey, i) => ({
        publicKey: bls.PublicKey.fromBytes(fromHexString(pubkey), CoordType.jacobian, true),
        message: fromHexString(messages[i]),
        signature: bls.Signature.fromBytes(fromHexString(signatures[i]), undefined, true),
      }))
    );
  } catch (e) {
    return false;
  }
}

/**
 * ```
 * input:
 *   privkey: bytes32 -- the private key used for signing
 *   message: bytes32 -- input message to sign (a hash)
 * output: BLS Signature -- expected output, single BLS signature or empty.
 * ```
 * https://github.com/ethereum/bls12-381-tests/blob/master/formats/sign.md
 */
function sign(input: {privkey: string; message: string}): string | null {
  const {privkey, message} = input;
  const signature = bls.sign(fromHexString(privkey), fromHexString(message));
  return toHexString(signature);
}

/**
 * ```
 * input:
 *   pubkey: bytes48 -- the pubkey
 *   message: bytes32 -- the message
 *   signature: bytes96 -- the signature to verify against pubkey and message
 * output: bool  -- VALID or INVALID
 * ```
 * https://github.com/ethereum/bls12-381-tests/blob/master/formats/verify.md
 */
function verify(input: {pubkey: string; message: string; signature: string}): boolean {
  const {pubkey, message, signature} = input;
  return bls.verify(fromHexString(pubkey), fromHexString(message), fromHexString(signature));
}

/**
 * ```
 * input: pubkey: bytes48 -- the pubkey
 * output: bool  -- VALID or INVALID
 * ```
 * https://github.com/ethereum/bls12-381-tests/blob/master/formats/deserialization_G1.md
 */
function deserialization_G1(input: {pubkey: string}): boolean {
  try {
    bls.PublicKey.fromBytes(fromHexString(input.pubkey), CoordType.jacobian, true);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * ```
 * input: signature: bytes92 -- the signature
 * output: bool  -- VALID or INVALID
 * ```
 * https://github.com/ethereum/bls12-381-tests/blob/master/formats/deserialization_G2.md
 */
function deserialization_G2(input: {signature: string}): boolean {
  try {
    bls.Signature.fromBytes(fromHexString(input.signature), undefined, true);
    return true;
  } catch (e) {
    return false;
  }
}
