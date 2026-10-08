import {GENESIS_EPOCH} from "@lodestar/params";
import {BLSPubkey, Epoch, Root} from "@lodestar/types";
import {Logger, defer, toPubkeyHex} from "@lodestar/utils";
import {uniqueVectorArr} from "../slashingProtection/utils.js";
import {LodestarValidatorDatabaseController, PubkeyHex} from "../types.js";
import {
  AttestationByTargetRepository,
  AttestationLowerBoundRepository,
  SlashingProtectionAttestationService,
} from "./attestation/index.js";
import {BlockBySlotRepository, SlashingProtectionBlockService} from "./block/index.js";
import {
  Interchange,
  InterchangeError,
  InterchangeErrorErrorCode,
  InterchangeFormatVersion,
  InterchangeLodestar,
  parseInterchange,
  serializeInterchange,
} from "./interchange/index.js";
import {ISlashingProtection} from "./interface.js";
import {DistanceStoreRepository, MinMaxSurround} from "./minMaxSurround/index.js";
import {SlashingProtectionAttestation, SlashingProtectionBlock} from "./types.js";

export {InvalidAttestationError, InvalidAttestationErrorCode} from "./attestation/index.js";
export {InvalidBlockError, InvalidBlockErrorCode} from "./block/index.js";
export type {Interchange, InterchangeFormat} from "./interchange/index.js";
export {InterchangeError, InterchangeErrorErrorCode} from "./interchange/index.js";
export type {ISlashingProtection, InterchangeFormatVersion, SlashingProtectionBlock, SlashingProtectionAttestation};
/**
 * Handles slashing protection for validator proposer and attester duties as well as slashing protection
 * during a validator interchange import/export process.
 */
export class SlashingProtection implements ISlashingProtection {
  private blockService: SlashingProtectionBlockService;
  private attestationService: SlashingProtectionAttestationService;
  private readonly importing = new Map<PubkeyHex, Promise<void>>();
  private lastImport: Promise<void> | null = null;

  constructor(protected db: LodestarValidatorDatabaseController) {
    const blockBySlotRepository = new BlockBySlotRepository(db);
    const attestationByTargetRepository = new AttestationByTargetRepository(db);
    const attestationLowerBoundRepository = new AttestationLowerBoundRepository(db);
    const distanceStoreRepository = new DistanceStoreRepository(db);
    const minMaxSurround = new MinMaxSurround(distanceStoreRepository);

    this.blockService = new SlashingProtectionBlockService(blockBySlotRepository);
    this.attestationService = new SlashingProtectionAttestationService(
      attestationByTargetRepository,
      attestationLowerBoundRepository,
      minMaxSurround
    );
  }

  async checkAndInsertBlockProposal(pubKey: BLSPubkey, block: SlashingProtectionBlock): Promise<void> {
    if (this.importing.size !== 0) {
      const pubkeyHex = toPubkeyHex(pubKey);
      let importing = this.importing.get(pubkeyHex);
      while (importing !== undefined) {
        await importing;
        importing = this.importing.get(pubkeyHex);
      }
    }
    await this.blockService.checkAndInsertBlockProposal(pubKey, block);
  }

  async checkAndInsertAttestation(pubKey: BLSPubkey, attestation: SlashingProtectionAttestation): Promise<void> {
    if (this.importing.size !== 0) {
      const pubkeyHex = toPubkeyHex(pubKey);
      let importing = this.importing.get(pubkeyHex);
      while (importing !== undefined) {
        await importing;
        importing = this.importing.get(pubkeyHex);
      }
    }
    await this.attestationService.checkAndInsertAttestation(pubKey, attestation);
  }

  async hasAttestedInEpoch(pubKey: BLSPubkey, epoch: Epoch): Promise<boolean> {
    return (await this.attestationService.getAttestationForEpoch(pubKey, epoch)) !== null;
  }

  async importInterchange(
    interchange: Interchange,
    genesisValidatorsRoot: Root,
    logger?: Logger,
    currentEpoch?: Epoch
  ): Promise<void> {
    const {data} = parseInterchange(interchange, genesisValidatorsRoot);
    if (currentEpoch !== undefined) {
      // Min-max span updates read the db for each epoch between source and target, allow one epoch of clock disparity
      const maxTargetEpoch = Math.max(currentEpoch, GENESIS_EPOCH) + 1;
      for (const validator of data) {
        for (const {targetEpoch} of validator.signedAttestations) {
          if (targetEpoch > maxTargetEpoch) {
            throw new InterchangeError({
              code: InterchangeErrorErrorCode.FUTURE_TARGET_EPOCH,
              targetEpoch,
              currentEpoch,
            });
          }
        }
      }
    }

    // Checks for keys in the file wait for the whole import, a key that is already signing must not sign against
    // a history the import is still extending. Per-key queues alone only cover the key currently being imported.
    // Imports run one after another so a later import cannot release a key an earlier one has not reached yet.
    const pubkeyHexes = data.map((validator) => toPubkeyHex(validator.pubkey));
    const previous = this.lastImport;
    const {promise, resolve} = defer<void>();
    this.lastImport = promise;
    for (const pubkeyHex of pubkeyHexes) {
      this.importing.set(pubkeyHex, promise);
    }

    try {
      if (previous !== null) {
        await previous;
      }
      for (const validator of data) {
        logger?.info("Importing slashing protection", {pubkey: toPubkeyHex(validator.pubkey)});
        await this.blockService.importBlocks(validator.pubkey, validator.signedBlocks);
        await this.attestationService.importAttestations(validator.pubkey, validator.signedAttestations);
      }
    } finally {
      resolve();
      if (this.lastImport === promise) {
        this.lastImport = null;
      }
      for (const pubkeyHex of pubkeyHexes) {
        if (this.importing.get(pubkeyHex) === promise) {
          this.importing.delete(pubkeyHex);
        }
      }
    }
  }

  async exportInterchange(
    genesisValidatorsRoot: Root,
    pubkeys: BLSPubkey[],
    formatVersion: InterchangeFormatVersion,
    logger?: Logger
  ): Promise<Interchange> {
    const validatorData: InterchangeLodestar["data"] = [];
    for (const pubkey of pubkeys) {
      logger?.info("Exporting slashing protection", {pubkey: toPubkeyHex(pubkey)});
      validatorData.push({
        pubkey,
        signedBlocks: await this.blockService.exportBlocks(pubkey),
        signedAttestations: await this.attestationService.exportAttestations(pubkey),
      });
    }
    logger?.verbose("Serializing Interchange");
    return serializeInterchange({data: validatorData, genesisValidatorsRoot}, formatVersion);
  }

  async listPubkeys(): Promise<BLSPubkey[]> {
    const pubkeysAtt = await this.attestationService.listPubkeys();
    const pubkeysBlk = await this.blockService.listPubkeys();
    return uniqueVectorArr([...pubkeysAtt, ...pubkeysBlk]);
  }
}
