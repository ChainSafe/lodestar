import {BLSPubkey, phase0, Root} from "@chainsafe/lodestar-types";
import {DatabaseService, IDatabaseApiOptions} from "@chainsafe/lodestar-db";
import {BlockBySlotRepository, SlashingProtectionBlockService} from "./block";
import {
  AttestationByTargetRepository,
  AttestationLowerBoundRepository,
  SlashingProtectionAttestationService,
} from "./attestation";
import {ISlashingProtection} from "./interface";
import {
  IInterchangeLodestar,
  Interchange,
  InterchangeFormatVersion,
  parseInterchange,
  serializeInterchange,
} from "./interchange";
import {MinMaxSurround, DistanceStoreRepository} from "./minMaxSurround";
import {uniqueVectorArr} from "../slashingProtection/utils";

export {InvalidAttestationError, InvalidAttestationErrorCode} from "./attestation";
export {InvalidBlockError, InvalidBlockErrorCode} from "./block";
export {InterchangeError, InterchangeErrorErrorCode} from "./interchange";
export {ISlashingProtection, InterchangeFormatVersion};

/**
 * Handles slashing protection for validator proposer and attester duties as well as slashing protection
 * during a validator interchange import/export process.
 */
export class SlashingProtection extends DatabaseService implements ISlashingProtection {
  private blockService: SlashingProtectionBlockService;
  private attestationService: SlashingProtectionAttestationService;

  constructor(opts: IDatabaseApiOptions) {
    super(opts);
    const blockBySlotRepository = new BlockBySlotRepository(opts);
    const attestationByTargetRepository = new AttestationByTargetRepository(opts);
    const attestationLowerBoundRepository = new AttestationLowerBoundRepository(opts);
    const distanceStoreRepository = new DistanceStoreRepository(opts);
    const minMaxSurround = new MinMaxSurround(distanceStoreRepository);

    this.blockService = new SlashingProtectionBlockService(opts.config, blockBySlotRepository);
    this.attestationService = new SlashingProtectionAttestationService(
      opts.config,
      attestationByTargetRepository,
      attestationLowerBoundRepository,
      minMaxSurround
    );
  }

  async checkAndInsertBlockProposal(pubKey: BLSPubkey, block: phase0.SlashingProtectionBlock): Promise<void> {
    await this.blockService.checkAndInsertBlockProposal(pubKey, block);
  }

  async checkAndInsertAttestation(pubKey: BLSPubkey, attestation: phase0.SlashingProtectionAttestation): Promise<void> {
    await this.attestationService.checkAndInsertAttestation(pubKey, attestation);
  }

  async importInterchange(interchange: Interchange, genesisValidatorsRoot: Root): Promise<void> {
    const {data} = parseInterchange(this.config, interchange, genesisValidatorsRoot);
    for (const validator of data) {
      await this.blockService.importBlocks(validator.pubkey, validator.signedBlocks);
      await this.attestationService.importAttestations(validator.pubkey, validator.signedAttestations);
    }
  }

  async exportInterchange(
    genesisValidatorsRoot: Root,
    pubkeys: BLSPubkey[],
    formatVersion: InterchangeFormatVersion
  ): Promise<Interchange> {
    const validatorData: IInterchangeLodestar["data"] = [];
    for (const pubkey of pubkeys) {
      validatorData.push({
        pubkey,
        signedBlocks: await this.blockService.exportBlocks(pubkey),
        signedAttestations: await this.attestationService.exportAttestations(pubkey),
      });
    }
    return serializeInterchange(this.config, {data: validatorData, genesisValidatorsRoot}, formatVersion);
  }

  async listPubkeys(): Promise<BLSPubkey[]> {
    const pubkeysAtt = await this.attestationService.listPubkeys();
    const pubkeysBlk = await this.blockService.listPubkeys();
    return uniqueVectorArr([...pubkeysAtt, ...pubkeysBlk]);
  }
}
