import {BLSPubkey, Root} from "@chainsafe/lodestar-types";
import {DatabaseService, IDatabaseApiOptions} from "@chainsafe/lodestar/lib/db/api/abstract";
import {SlashingProtectionBlockRepository} from "./block";
import {SlashingProtectionAttestationRepository} from "./attestation";
import {
  Interchange,
  parseInterchange,
  InterchangeFormatVersion,
  serializeInterchange,
  IInterchangeLodestar,
} from "./interchange";

export class SlashingProtectionManager extends DatabaseService {
  private blockRepository: SlashingProtectionBlockRepository;
  private attestationRepository: SlashingProtectionAttestationRepository;

  constructor(opts: IDatabaseApiOptions) {
    super(opts);
    this.blockRepository = new SlashingProtectionBlockRepository(this.config, this.db);
    this.attestationRepository = new SlashingProtectionAttestationRepository(this.config, this.db);
  }

  /**
   * Import slashing protection from another client in the interchange format
   */
  public async importInterchange(interchange: Interchange, genesisValidatorsRoot: Root): Promise<void> {
    const validators = parseInterchange(interchange, genesisValidatorsRoot);
    for (const validator of validators) {
      await this.blockRepository.setByPubkey(validator.pubkey, validator.signedBlocks);
      await this.attestationRepository.setByPubkey(validator.pubkey, validator.signedAttestations);
    }
  }

  /**
   * Export serialized slashing protection data for another client in the interchange format
   */
  public async exportInterchange(
    genesisValidatorsRoot: Root,
    pubkeys: BLSPubkey[],
    formatVersion: InterchangeFormatVersion
  ): Promise<Interchange> {
    const validatorData: IInterchangeLodestar["data"] = [];
    for (const pubkey of pubkeys) {
      validatorData.push({
        pubkey,
        signedBlocks: await this.blockRepository.getAllByPubkey(pubkey),
        signedAttestations: await this.attestationRepository.getAllByPubkey(pubkey),
      });
    }
    return serializeInterchange({data: validatorData, genesisValidatorsRoot}, formatVersion);
  }
}
