import {byteArrayEquals} from "@chainsafe/ssz";
import {ApiError} from "@lodestar/api/server";
import {PubkeyHex, SignRequest} from "@lodestar/api/signer";
import {SignerApiMethods} from "@lodestar/api/signer/server";
import {ChainForkConfig} from "@lodestar/config";
import {SecretKey} from "@lodestar/native/blst";
import {BLSPubkey, Root} from "@lodestar/types";
import {Logger, toPubkeyHex, toRootHex} from "@lodestar/utils";
import {ISlashingProtection, InvalidAttestationError, InvalidBlockError} from "@lodestar/validator";
import {Metrics, SignResult} from "./metrics.js";
import {SlashingProtectionData, getSigningRoot} from "./signingRoot.js";

/**
 * Persists the genesis validators root the slashing protection database belongs to
 */
export type GenesisValidatorsRootStore = {
  getGenesisValidatorsRoot(): Promise<Root | null>;
  setGenesisValidatorsRoot(genesisValidatorsRoot: Root): Promise<void>;
};

export type SignerModules = {
  config: ChainForkConfig;
  slashingProtection: ISlashingProtection;
  metadata: GenesisValidatorsRootStore;
  logger: Logger;
  metrics: Metrics | null;
};

export type SignerInitOptions = {
  secretKeys: SecretKey[];
  /** Known genesis validators root of the network, persisted if the database does not have one yet */
  genesisValidatorsRoot?: Root;
};

type LoadedKey = {pubkey: BLSPubkey; secretKey: SecretKey};

/**
 * Serves the remote signing API for a set of local secret keys. Every block and attestation signature is checked
 * against the slashing protection database before it is produced.
 */
export class Signer implements SignerApiMethods {
  private readonly keys = new Map<PubkeyHex, LoadedKey>();
  private genesisValidatorsRoot: Root | null;

  private constructor(
    private readonly modules: SignerModules,
    secretKeys: SecretKey[],
    genesisValidatorsRoot: Root | null
  ) {
    for (const secretKey of secretKeys) {
      const publicKey = secretKey.toPublicKey();
      this.keys.set(publicKey.toHex(), {pubkey: publicKey.toBytes(), secretKey});
    }
    this.genesisValidatorsRoot = genesisValidatorsRoot;
    modules.metrics?.keys.set(this.keys.size);
  }

  static async init(modules: SignerModules, opts: SignerInitOptions): Promise<Signer> {
    const persisted = await modules.metadata.getGenesisValidatorsRoot();
    const genesisValidatorsRoot = persisted ?? opts.genesisValidatorsRoot ?? null;

    if (persisted === null && genesisValidatorsRoot !== null) {
      await modules.metadata.setGenesisValidatorsRoot(genesisValidatorsRoot);
    }
    if (genesisValidatorsRoot !== null) {
      modules.logger.info("Slashing protection database genesis validators root", {
        genesisValidatorsRoot: toRootHex(genesisValidatorsRoot),
      });
    }

    return new Signer(modules, opts.secretKeys, genesisValidatorsRoot);
  }

  get pubkeys(): PubkeyHex[] {
    return Array.from(this.keys.keys());
  }

  async upcheck(): Promise<{data: {status: string}}> {
    return {data: {status: "OK"}};
  }

  async listPublicKeys(): Promise<{data: PubkeyHex[]}> {
    return {data: this.pubkeys};
  }

  async sign({pubkey, signingRoot, forkInfo, message}: SignRequest): Promise<{data: {signature: Uint8Array}}> {
    const {metrics, logger} = this.modules;
    const timer = metrics?.signTime.startTimer({type: message.type});

    try {
      const key = this.keys.get(normalizePubkeyHex(pubkey));
      if (key === undefined) {
        throw new ApiError(404, `Public key ${pubkey} not found`);
      }

      const computed = getSigningRoot(this.modules.config, message, forkInfo);
      if (signingRoot !== undefined && !byteArrayEquals(signingRoot, computed.signingRoot)) {
        throw new ApiError(
          400,
          `Signing root ${toRootHex(signingRoot)} does not match signing root ${toRootHex(computed.signingRoot)} computed from ${message.type} data`
        );
      }

      if (computed.slashingProtection !== null) {
        if (forkInfo === undefined) {
          throw new ApiError(400, `Signing request of type ${message.type} requires fork_info`);
        }
        await this.checkSlashingProtection(
          key.pubkey,
          forkInfo.genesisValidatorsRoot,
          computed.slashingProtection,
          computed.signingRoot
        );
      }

      const signature = key.secretKey.sign(computed.signingRoot).toBytes();
      metrics?.signRequests.inc({type: message.type, result: SignResult.signed});
      logger.debug("Signed message", {type: message.type, pubkey, signingRoot: toRootHex(computed.signingRoot)});

      return {data: {signature}};
    } catch (e) {
      metrics?.signRequests.inc({type: message.type, result: toSignResult(e)});
      throw e;
    } finally {
      timer?.();
    }
  }

  private async checkSlashingProtection(
    pubkey: BLSPubkey,
    genesisValidatorsRoot: Root,
    data: SlashingProtectionData,
    signingRoot: Root
  ): Promise<void> {
    const {slashingProtection, logger} = this.modules;

    this.assertGenesisValidatorsRoot(genesisValidatorsRoot);

    try {
      switch (data.kind) {
        case "block":
          await slashingProtection.checkAndInsertBlockProposal(pubkey, {slot: data.slot, signingRoot});
          break;
        case "attestation":
          await slashingProtection.checkAndInsertAttestation(pubkey, {
            sourceEpoch: data.sourceEpoch,
            targetEpoch: data.targetEpoch,
            signingRoot,
          });
          break;
      }
    } catch (e) {
      if (e instanceof InvalidBlockError || e instanceof InvalidAttestationError) {
        logger.warn("Rejected signing request, slashing protection", {...data, pubkey: toPubkeyHex(pubkey)}, e);
        throw new ApiError(412, `Slashing protection rejected ${data.kind} signing request: ${e.message}`);
      }
      throw e;
    }
  }

  /**
   * The slashing protection database only tracks messages of a single chain. The first protected request pins the
   * genesis validators root, any later request for a different chain is rejected instead of being tracked separately.
   */
  private assertGenesisValidatorsRoot(genesisValidatorsRoot: Root): void {
    if (this.genesisValidatorsRoot === null) {
      this.genesisValidatorsRoot = genesisValidatorsRoot;
      this.modules.logger.info("Pinning slashing protection database to genesis validators root", {
        genesisValidatorsRoot: toRootHex(genesisValidatorsRoot),
      });
      this.modules.metadata.setGenesisValidatorsRoot(genesisValidatorsRoot).catch((e: Error) => {
        this.modules.logger.error("Error persisting genesis validators root", {}, e);
      });
      return;
    }

    if (!byteArrayEquals(this.genesisValidatorsRoot, genesisValidatorsRoot)) {
      throw new ApiError(
        400,
        `Genesis validators root ${toRootHex(genesisValidatorsRoot)} does not match ${toRootHex(this.genesisValidatorsRoot)} of the slashing protection database`
      );
    }
  }
}

function toSignResult(e: unknown): SignResult {
  if (!(e instanceof ApiError)) {
    return SignResult.error;
  }
  switch (e.statusCode) {
    case 400:
      return SignResult.invalidRequest;
    case 404:
      return SignResult.unknownKey;
    case 412:
      return SignResult.slashable;
    default:
      return SignResult.error;
  }
}

/**
 * Identifiers are matched case insensitive with or without the 0x prefix, Web3Signer behaves the same way
 */
function normalizePubkeyHex(pubkey: string): PubkeyHex {
  const lower = pubkey.toLowerCase();
  return lower.startsWith("0x") ? lower : `0x${lower}`;
}
