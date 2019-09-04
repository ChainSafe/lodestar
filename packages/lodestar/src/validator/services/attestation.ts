/**
 * @module validator/attestation
 */
import {hashTreeRoot} from "@chainsafe/ssz";

import {
  Attestation,
  AttestationData,
  AttestationDataAndCustodyBit,
  BeaconState,
  Fork,
  IndexedAttestation,
  Shard,
  Slot
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {computeEpochOfSlot, getDomain, isSlashableAttestationData,} from "../../chain/stateTransition/util";

import {RpcClient} from "../rpc";

import {DomainType} from "../../constants";
import {IValidatorDB} from "../../db/api";
import {ILogger} from "../../logger";
import {Keypair} from "@chainsafe/bls";

export class AttestationService {

  private config: IBeaconConfig;
  private rpcClient: RpcClient;
  private keypair: Keypair;
  private db: IValidatorDB;
  private logger: ILogger;

  public constructor(
    config: IBeaconConfig,
    keypair: Keypair,
    rpcClient: RpcClient,
    db: IValidatorDB,
    logger: ILogger
  ) {
    this.config = config;
    this.rpcClient = rpcClient;
    this.keypair = keypair;
    this.db = db;
    this.logger = logger;
  }


  public async createAndPublishAttestation(
    slot: Slot,
    shard: Shard,
    fork: Fork): Promise<Attestation> {
    const attestation = await this.rpcClient.validator.produceAttestation(
      this.keypair.publicKey.toBytesCompressed(),
      false,
      slot,
      shard
    );
    if (await this.isConflictingAttestation(attestation.data)) {
      this.logger.warn(
        `[Validator] Avoided signing conflicting attestation! `
        + `Source epoch: ${attestation.data.source.epoch}, Target epoch: ${computeEpochOfSlot(this.config, slot)}`
      );
      return null;
    }
    const attestationDataAndCustodyBit: AttestationDataAndCustodyBit = {
      custodyBit: false,
      data: attestation.data
    };
    attestation.signature = this.keypair.privateKey.signMessage(
      hashTreeRoot(attestationDataAndCustodyBit, this.config.types.AttestationDataAndCustodyBit),
      getDomain(
        this.config,
        {fork} as BeaconState, // eslint-disable-line @typescript-eslint/no-object-literal-type-assertion
        DomainType.ATTESTATION,
        computeEpochOfSlot(this.config, slot),
      )
    ).toBytesCompressed();
    await this.storeAttestation(attestation);
    await this.rpcClient.validator.publishAttestation(attestation);
    this.logger.info(`[Validator] Signed and publish new attestation`);
    return attestation;
  }

  private async isConflictingAttestation(other: AttestationData): Promise<boolean> {
    const potentialAttestationConflicts =
      await this.db.getAttestations(this.keypair.publicKey.toBytesCompressed(), {gt: other.target.epoch - 1});
    return potentialAttestationConflicts.some((attestation => {
      return isSlashableAttestationData(this.config, attestation.data, other);
    }));
  }

  private async storeAttestation(attestation: Attestation): Promise<void> {
    await this.db.setAttestation(this.keypair.publicKey.toBytesCompressed(), attestation);

    //cleanup
    const unusedAttestations =
      await this.db.getAttestations(this.keypair.publicKey.toBytesCompressed(), {gt: 0, lt: attestation.data.target.epoch});
    await this.db.deleteAttestations(this.keypair.publicKey.toBytesCompressed(), unusedAttestations);
  }
}
