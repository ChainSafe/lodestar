/**
 * @module validator
 */
import {SecretKey} from "@chainsafe/bls";
import {BLSPubkey, phase0} from "@chainsafe/lodestar-types";
import {IDatabaseController} from "@chainsafe/lodestar-db";
import {SlashingProtectionAttestation} from "./slashingProtection";
import {SafeStatus} from "./slashingProtection/attestation";
import {routes} from "@chainsafe/lodestar-api";

export type GenesisInfo = {
  startTime: number;
};

export type BLSKeypair = {
  publicKey: BLSPubkey;
  secretKey: SecretKey;
};

export type PubkeyHex = string;
export type LodestarValidatorDatabaseController = Pick<
  IDatabaseController<Buffer, Buffer>,
  "get" | "start" | "values" | "batchPut" | "keys" | "get" | "put"
>;

export type AttestationSigningResult = {
  duty: routes.validator.AttesterDuty;
  attestation: phase0.Attestation;
  slashingProtection: SlashingProtectionAttestation;
  safeStatus: SafeStatus;
};
