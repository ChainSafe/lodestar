import bls from "@chainsafe/bls";
import type {SecretKey} from "@chainsafe/bls/types";
import {ApiError, getClient} from "@lodestar/api";
import {phase0, ssz} from "@lodestar/types";
import {config as chainConfig} from "@lodestar/config/default";
import {createBeaconConfig, BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_ATTESTER, MAX_VALIDATORS_PER_COMMITTEE} from "@lodestar/params";
import {toHexString} from "@lodestar/utils";
import {computeSigningRoot} from "@lodestar/state-transition";
import {CliCommand} from "../util/command.js";
import {deriveSecretKeys, SecretKeysArgs, secretKeysOptions} from "../util/deriveSecretKeys.js";

/* eslint-disable no-console */

type SelfSlashArgs = SecretKeysArgs & {
  server: string;
  slot: string;
  batchSize: string;
};

export const selfSlashAttester: CliCommand<SelfSlashArgs, Record<never, never>, void> = {
  command: "self-slash-attester",
  describe: "Self slash validators of a provided mnemonic with AttesterSlashing",
  examples: [
    {
      command: "self-slash-proposer --network goerli",
      description: "Self slash validators of a provided mnemonic",
    },
  ],
  options: {
    ...secretKeysOptions,
    server: {
      description: "Address to connect to BeaconNode",
      default: "http://127.0.0.1:9596",
      type: "string",
    },
    slot: {
      description: "AttesterSlashing data slot",
      default: "0",
      type: "string",
    },
    batchSize: {
      description: "Add batchSize validators in each AttesterSlashing. Must be < MAX_VALIDATORS_PER_COMMITTEE",
      default: "10",
      type: "string",
    },
  },
  handler: selfSlashAttesterHandler,
};

export async function selfSlashAttesterHandler(args: SelfSlashArgs): Promise<void> {
  const sksAll = deriveSecretKeys(args);

  const slot = BigInt(args.slot); // Throws if not valid
  const batchSize = parseInt(args.batchSize);

  if (isNaN(batchSize)) throw Error(`Invalid arg batchSize ${args.batchSize}`);
  if (batchSize <= 0) throw Error(`batchSize must be > 0: ${batchSize}`);
  if (batchSize > MAX_VALIDATORS_PER_COMMITTEE) throw Error("batchSize must be < MAX_VALIDATORS_PER_COMMITTEE");

  // TODO: Ask the user to confirm the range and slash action

  const client = getClient({baseUrl: args.server}, {config: chainConfig});

  // Get genesis data to perform correct signatures
  const res = await client.beacon.getGenesis();
  ApiError.assert(res, "Can not fetch genesis data from beacon node");

  const config = createBeaconConfig(chainConfig, res.response.data.genesisValidatorsRoot);

  // TODO: Allow to customize the ProposerSlashing payloads

  const rootA = Buffer.alloc(32, 0xaa);
  const rootB = Buffer.alloc(32, 0xbb);

  // To log progress
  let successCount = 0;
  const totalCount = sksAll.length;

  for (let n = 0; n < sksAll.length; n += batchSize) {
    const sks = sksAll.slice(n, n + batchSize);

    // Retrieve the status all all validators in range at once
    const pksHex = sks.map((sk) => sk.toPublicKey().toHex());
    const res = await client.beacon.getStateValidators("head", {id: pksHex});
    ApiError.assert(res, "Can not fetch state validators from beacon node");

    // All validators in the batch will be part of the same AttesterSlashing
    const validators = res.response.data;
    const attestingIndices = validators.map((v) => v.index);

    // Submit all ProposerSlashing for range at once

    // Ensure sorted response
    for (let i = 0; i < pksHex.length; i++) {
      const {index, status, validator} = validators[i];
      const pkHex = pksHex[i];
      const validatorPkHex = toHexString(validator.pubkey);
      if (validatorPkHex !== pkHex) {
        throw Error(`getStateValidators did not return same validator pubkey: ${validatorPkHex} != ${pkHex}`);
      }

      if (status === "active_slashed" || status === "exited_slashed") {
        console.log(`Warning: validator index ${index} is already slashed`);
      }
    }

    // Trigers a double vote, same target epoch different data (beaconBlockRoot)
    // TODO: Allow to create double-votes
    const data1: phase0.AttestationDataBigint = {
      slot,
      index: BigInt(0),
      beaconBlockRoot: rootA,
      source: {epoch: BigInt(0), root: rootA},
      target: {epoch: BigInt(0), root: rootB},
    };
    const data2: phase0.AttestationDataBigint = {
      slot,
      index: BigInt(0),
      beaconBlockRoot: rootB,
      source: {epoch: BigInt(0), root: rootA},
      target: {epoch: BigInt(0), root: rootB},
    };

    const attesterSlashing: phase0.AttesterSlashing = {
      attestation1: {
        attestingIndices,
        data: data1,
        signature: signAttestationDataBigint(config, sks, data1),
      },
      attestation2: {
        attestingIndices,
        data: data2,
        signature: signAttestationDataBigint(config, sks, data2),
      },
    };

    ApiError.assert(await client.beacon.submitPoolAttesterSlashings(attesterSlashing));

    successCount += attestingIndices.length;
    const indexesStr = attestingIndices.join(",");
    console.log(`Submitted self AttesterSlashing for validators ${indexesStr} - ${successCount}/${totalCount}`);
  }
}

function signAttestationDataBigint(
  config: BeaconConfig,
  sks: SecretKey[],
  data: phase0.AttestationDataBigint
): Uint8Array {
  const slot = Number(data.slot as bigint);
  const proposerDomain = config.getDomain(slot, DOMAIN_BEACON_ATTESTER);
  const signingRoot = computeSigningRoot(ssz.phase0.AttestationDataBigint, data, proposerDomain);

  const sigs = sks.map((sk) => sk.sign(signingRoot));
  return bls.Signature.aggregate(sigs).toBytes();
}
