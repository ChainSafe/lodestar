import type {SecretKey} from "@chainsafe/bls/types";
import {getClient} from "@lodestar/api";
import {phase0, ssz} from "@lodestar/types";
import {config as chainConfig} from "@lodestar/config/default";
import {createIBeaconConfig, IBeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_PROPOSER} from "@lodestar/params";
import {toHexString} from "@lodestar/utils";
import {computeSigningRoot} from "@lodestar/state-transition";
import {ICliCommand} from "../util/command.js";
import {deriveSecretKeys, SecretKeysArgs, secretKeysOptions} from "../util/deriveSecretKeys.js";

/* eslint-disable no-console */

type SelfSlashArgs = SecretKeysArgs & {
  server: string;
  slot: string;
  batchSize: string;
};

export const selfSlashProposer: ICliCommand<SelfSlashArgs, Record<never, never>, void> = {
  command: "self-slash-proposer",
  describe: "Self slash validators of a provided mnemonic with ProposerSlashing",
  examples: [
    {
      command: "self-slash-proposer --network prater",
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
      description: "ProposerSlashing headers slot",
      default: "0",
      type: "string",
    },
    batchSize: {
      description: "Send in batches of size batchSize",
      default: "10",
      type: "string",
    },
  },
  handler: selfSlashProposerHandler,
};

export async function selfSlashProposerHandler(args: SelfSlashArgs): Promise<void> {
  const sksAll = deriveSecretKeys(args);

  const slot = BigInt(args.slot); // Throws if not valid
  const batchSize = parseInt(args.batchSize);

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

  // To log progress
  let successCount = 0;
  const totalCount = sksAll.length;

  for (let n = 0; n < sksAll.length; n += batchSize) {
    const sks = sksAll.slice(n, n + batchSize);

    // Retrieve the status all all validators in range at once
    const pksHex = sks.map((sk) => sk.toPublicKey().toHex());
    const {data: validators} = await client.beacon.getStateValidators("head", {id: pksHex});

    // Submit all ProposerSlashing for range at once
    await Promise.all(
      pksHex.map(async (pkHex, i) => {
        const sk = sks[i];
        const {index, status, validator} = validators[i];

        try {
          const validatorPkHex = toHexString(validator.pubkey);
          if (validatorPkHex !== pkHex) {
            throw Error(`getStateValidators did not return same validator pubkey: ${validatorPkHex} != ${pkHex}`);
          }

          if (status === "active_slashed" || status === "exited_slashed") {
            console.log(`Warning: validator index ${index} is already slashed`);
          }

          const header1: phase0.BeaconBlockHeaderBigint = {
            slot,
            proposerIndex: index,
            parentRoot: rootA,
            stateRoot: rootA,
            bodyRoot: rootA,
          };
          const header2: phase0.BeaconBlockHeaderBigint = {
            slot,
            proposerIndex: index,
            parentRoot: rootB,
            stateRoot: rootB,
            bodyRoot: rootB,
          };

          const proposerSlashing: phase0.ProposerSlashing = {
            signedHeader1: {
              message: header1,
              signature: signHeaderBigint(config, sk, header1),
            },
            signedHeader2: {
              message: header2,
              signature: signHeaderBigint(config, sk, header2),
            },
          };

          await client.beacon.submitPoolProposerSlashing(proposerSlashing);

          console.log(`Submitted self ProposerSlashing for validator ${index} - ${++successCount}/${totalCount}`);
        } catch (e) {
          (e as Error).message = `Error slashing validator ${index}: ${(e as Error).message}`;
        }
      })
    );
  }
}

function signHeaderBigint(config: IBeaconConfig, sk: SecretKey, header: phase0.BeaconBlockHeaderBigint): Uint8Array {
  const slot = Number(header.slot as bigint);
  const proposerDomain = config.getDomain(DOMAIN_BEACON_PROPOSER, slot);
  const signingRoot = computeSigningRoot(ssz.phase0.BeaconBlockHeaderBigint, header, proposerDomain);
  return sk.sign(signingRoot).toBytes();
}
