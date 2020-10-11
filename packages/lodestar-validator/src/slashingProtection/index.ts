import {BLSPubkey, SlashingProtectionBlock, SlashingProtectionAttestation} from "@chainsafe/lodestar-types";
import {checkAndInsertBlockProposal, SlashingProtectionBlockRepository} from "./block";
import {checkAndInsertAttestation, SlashingProtectionAttestationRepository} from "./attestation";
import {DatabaseService, IDatabaseApiOptions} from "@chainsafe/lodestar/lib/db/api/abstract";
import {ISlashingProtection} from "./interface";

export {ISlashingProtection};

export class SlashingProtection extends DatabaseService implements ISlashingProtection {
  private blockRepository: SlashingProtectionBlockRepository;
  private attestationRepository: SlashingProtectionAttestationRepository;

  constructor(opts: IDatabaseApiOptions) {
    super(opts);
    this.blockRepository = new SlashingProtectionBlockRepository(this.config, this.db);
    this.attestationRepository = new SlashingProtectionAttestationRepository(this.config, this.db);
  }

  public async checkAndInsertBlockProposal(pubKey: BLSPubkey, block: SlashingProtectionBlock): Promise<void> {
    await checkAndInsertBlockProposal(pubKey, block, this.blockRepository);
  }

  public async checkAndInsertAttestation(pubKey: BLSPubkey, attestation: SlashingProtectionAttestation): Promise<void> {
    await checkAndInsertAttestation(pubKey, attestation, this.attestationRepository);
  }
}
