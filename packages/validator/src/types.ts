/**
 * @module validator
 */
import type {SecretKey} from "@chainsafe/bls/types";
import {BLSPubkey} from "@chainsafe/lodestar-types";
import {IDatabaseController} from "@chainsafe/lodestar-db";

export type GenesisInfo = {
  startTime: number;
};

export type BLSKeypair = {
  publicKey: BLSPubkey;
  secretKey: SecretKey;
};

/**
 * The validator's BLS public key, uniquely identifying them. _48-bytes, hex encoded with 0x prefix, case insensitive._
 * ```
 * "0x93247f2209abcacf57b75a51dafae777f9dd38bc7053d1af526f220a7489a6d3a2753e5f3e8b1cfe39b56f43611df74a"
 * ```
 */
export type PubkeyHex = string;

export type LodestarValidatorDatabaseController = Pick<
  IDatabaseController<Uint8Array, Uint8Array>,
  "get" | "start" | "values" | "batchPut" | "keys" | "get" | "put"
>;
