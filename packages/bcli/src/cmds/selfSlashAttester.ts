import bls from "@chainsafe/bls";
import type {SecretKey} from "@chainsafe/bls/types";
import {getClient} from "@chainsafe/lodestar-api";
import {deriveEth2ValidatorKeys, deriveKeyFromMnemonic} from "@chainsafe/bls-keygen";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {config as chainConfig} from "@chainsafe/lodestar-config/default";
import {createIBeaconConfig, IBeaconConfig} from "@chainsafe/lodestar-config";
import {DOMAIN_BEACON_ATTESTER} from "@chainsafe/lodestar-params";
import {toHexString} from "@chainsafe/lodestar-utils";
import {computeSigningRoot} from "@chainsafe/lodestar-beacon-state-transition";
import {ICliCommand} from "../util/command.js";
import {YargsError} from "../util/errors.js";
import {parseRange} from "../util/format.js";

/* eslint-disable no-console */

type SelfSlashArgs = {
  mnemonic?: string;
  indexes?: string;
  server: string;
  slot?: string;
  batchSize?: string;
};

export const selfSlashAttester: ICliCommand<SelfSlashArgs, Record<never, never>, void> = {
  command: "init",
  describe: "Self slash validators of a provided mnemonic.",
  examples: [
    {
      command: "self-slash-proposer --network prater",
      description: "Self slash validators of a provided mnemonic",
    },
  ],
  options: {
    mnemonic: {
      description: "Mnemonic to derive private keys from",
      type: "string",
    },
    indexes: {
      description: "Range of indexes to select, in inclusive range with notation '0:7'",
      type: "string",
    },
    server: {
      description: "Address to connect to BeaconNode",
      default: "http://127.0.0.1:9596",
      type: "string",
    },
    slot: {
      description: "Address to connect to BeaconNode",
      default: "http://127.0.0.1:9596",
      type: "string",
    },
    batchSize: {
      description: "Send in batches of size batchSize",
      default: "10",
      type: "string",
    },
  },
  handler: selfSlashAttesterHandler,
};

export async function selfSlashAttesterHandler(args: SelfSlashArgs): Promise<void> {
  if (!args.mnemonic) throw new YargsError("arg mnemonic is required");
  if (!args.indexes) throw new YargsError("arg indexes is required");

  const masterSK = deriveKeyFromMnemonic(args.mnemonic);
  const indexes = parseRange(args.indexes);
  const slot = args.slot ? BigInt(args.slot) : BigInt(0); // Throws if not valid
  const batchSize = args.batchSize ? parseInt(args.batchSize) : 10;

  if (isNaN(batchSize)) throw Error(`Invalid arg batchSize ${args.batchSize}`);
  if (batchSize <= 0) throw Error(`batchSize must be > 0: ${batchSize}`);

  // TODO: Ask the user to confirm the range and slash action

  const client = getClient({baseUrl: args.server}, {config: chainConfig});

  // Get genesis data to perform correct signatures
  const {data: genesis} = await client.beacon.getGenesis();
  const config = createIBeaconConfig(chainConfig, genesis.genesisValidatorsRoot);

  // TODO: Allow to customize the ProposerSlashing payloads

  const rootA = Buffer.alloc(32, 0xaa);
  const rootB = Buffer.alloc(32, 0xbb);
  let successCount = 0; // To log progress

  for (let n = 0; n < indexes.length; n += batchSize) {
    const indexesRange = indexes.slice(n, n + batchSize);

    const sks = indexesRange.map((index) => {
      const {signing} = deriveEth2ValidatorKeys(masterSK, index);
      return bls.SecretKey.fromBytes(signing);
    });

    // Retrieve the status all all validators in range at once
    const pksHex = sks.map((sk) => sk.toPublicKey().toHex());
    const {data: validators} = await client.beacon.getStateValidators("head", {id: pksHex});

    // All validators in the batch will be part of the same AttesterSlashing
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

    await client.beacon.submitPoolAttesterSlashing(attesterSlashing);

    successCount += attestingIndices.length;
    const indexesStr = attestingIndices.join(",");
    console.log(`Submitted self AttesterSlashing for validators ${indexesStr} - ${++successCount}/${indexes.length}`);
  }
}

function signAttestationDataBigint(
  config: IBeaconConfig,
  sks: SecretKey[],
  data: phase0.AttestationDataBigint
): Uint8Array {
  const slot = Number(data.slot as bigint);
  const proposerDomain = config.getDomain(DOMAIN_BEACON_ATTESTER, slot);
  const signingRoot = computeSigningRoot(ssz.phase0.AttestationDataBigint, data, proposerDomain);

  const sigs = sks.map((sk) => sk.sign(signingRoot));
  return bls.Signature.aggregate(sigs).toBytes();
}
