import {
  PublicKey,
  SecretKey,
  Signature,
  aggregateSignatures,
  aggregateVerify,
  fastAggregateVerify,
  verifyMultipleAggregateSignatures,
  verify as _verify,
} from "@chainsafe/blst";
import {fromHexString} from "@chainsafe/ssz";

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
  try {
    return aggregateVerify(
      messages.map(fromHexString),
      pubkeys.map((pk) => PublicKey.fromHex(pk)),
      Signature.fromHex(signature)
    );
  } catch (_e) {
    return false;
  }
}

/**
 * ```
 * input: List[BLS Signature] -- list of input BLS signatures
 * output: BLS Signature -- expected output, single BLS signature or `null`.
 * ```
 */
function aggregate(input: string[]): string {
  const pks = input.map((pkHex) => Signature.fromHex(pkHex));
  const agg = aggregateSignatures(pks);
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
    return fastAggregateVerify(
      fromHexString(message),
      pubkeys.map((hex) => PublicKey.fromHex(hex, true)),
      Signature.fromHex(signature, true)
    );
  } catch (_e) {
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
    return verifyMultipleAggregateSignatures(
      pubkeys.map((pubkey, i) => ({
        pk: PublicKey.fromHex(pubkey, true),
        msg: fromHexString(messages[i]),
        sig: Signature.fromHex(signatures[i], true),
      }))
    );
  } catch (_e) {
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
  const signature = SecretKey.fromHex(privkey).sign(fromHexString(message));
  return signature.toHex();
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
  try {
    return _verify(fromHexString(message), PublicKey.fromHex(pubkey), Signature.fromHex(signature));
  } catch (_e) {
    return false;
  }
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
    PublicKey.fromHex(input.pubkey, true);
    return true;
  } catch (_e) {
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
    Signature.fromHex(input.signature, true);
    return true;
  } catch (_e) {
    return false;
  }
}
