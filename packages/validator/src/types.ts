/**
 * @module validator
 */
import {SecretKey} from "@chainsafe/bls";
import {BLSPubkey} from "@chainsafe/lodestar-types";
import {IDatabaseController} from "@chainsafe/lodestar-db";

export type GenesisInfo = {
  startTime: number;
};

export type BLSKeypair = {
  publicKey: BLSPubkey;
  secretKey: SecretKey;
};

export type PubkeyHex = string;
export type LodestarValidatorDatabaseController = Pick<
  IDatabaseController<Uint8Array, Uint8Array>,
  "get" | "start" | "values" | "batchPut" | "keys" | "get" | "put"
>;
