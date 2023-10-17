import {toHexString} from "@chainsafe/ssz";
import {BLSPubkey, Epoch, Root} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {LodestarValidatorDatabaseController} from "../types.js";
import {uniqueVectorArr} from "../slashingProtection/utils.js";
import {BlockBySlotRepository, SlashingProtectionBlockService} from "./block/index.js";
import {
  AttestationByTargetRepository,
  AttestationLowerBoundRepository,
  SlashingProtectionAttestationService,
} from "./attestation/index.js";
import {ISlashingProtection} from "./interface.js";
import {
  InterchangeLodestar,
  Interchange,
  InterchangeFormatVersion,
  parseInterchange,
  serializeInterchange,
} from "./interchange/index.js";
import {MinMaxSurround, DistanceStoreRepository} from "./minMaxSurround/index.js";
import {SlashingProtectionBlock, SlashingProtectionAttestation} from "./types.js";

export {InvalidAttestationError, InvalidAttestationErrorCode} from "./attestation/index.js";
export {InvalidBlockError, InvalidBlockErrorCode} from "./block/index.js";
export {InterchangeError, InterchangeErrorErrorCode} from "./interchange/index.js";
export type {Interchange, InterchangeFormat} from "./interchange/index.js";
export type {ISlashingProtection, InterchangeFormatVersion, SlashingProtectionBlock, SlashingProtectionAttestation};
/**
 * Handles slashing protection for validator proposer and attester duties as well as slashing protection
 * during a validator interchange import/export process.
 */
export class SlashingProtection implements ISlashingProtection {
  private blockService: SlashingProtectionBlockService;
  private attestationService: SlashingProtectionAttestationService;

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
    await this.blockService.checkAndInsertBlockProposal(pubKey, block);
  }

  async checkAndInsertAttestation(pubKey: BLSPubkey, attestation: SlashingProtectionAttestation): Promise<void> {
    await this.attestationService.checkAndInsertAttestation(pubKey, attestation);
  }

  async hasAttestedInEpoch(pubKey: BLSPubkey, epoch: Epoch): Promise<boolean> {
    return (await this.attestationService.getAttestationForEpoch(pubKey, epoch)) !== null;
  }

  async importInterchange(interchange: Interchange, genesisValidatorsRoot: Root, logger?: Logger): Promise<void> {
    const {data} = parseInterchange(interchange, genesisValidatorsRoot);
    for (const validator of data) {
      logger?.info("Importing slashing protection", {pubkey: toHexString(validator.pubkey)});
      await this.blockService.importBlocks(validator.pubkey, validator.signedBlocks);
      await this.attestationService.importAttestations(validator.pubkey, validator.signedAttestations);
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
      logger?.info("Exporting slashing protection", {pubkey: toHexString(pubkey)});
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
