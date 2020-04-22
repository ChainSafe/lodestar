import assert from "assert";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {Attestation, AttestationRootHex, BlockRootHex, Root, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getAttestingIndices,
  getCurrentSlot
} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";

import {ChainEventEmitter, IAttestationProcessor} from "./interface";
import {ILMDGHOST} from ".";
import {IBeaconDb} from "../db";
import {GENESIS_EPOCH} from "../constants";

export class AttestationProcessor implements IAttestationProcessor {
  private readonly config: IBeaconConfig;
  private db: IBeaconDb;
  private logger: ILogger;
  private chain: ChainEventEmitter;
  private forkChoice: ILMDGHOST;
  private pendingAttestations: Map<BlockRootHex, Map<AttestationRootHex, Attestation>>;

  public constructor(
    chain: ChainEventEmitter,
    forkChoice: ILMDGHOST,
    {config, db, logger}: { config: IBeaconConfig; db: IBeaconDb; logger: ILogger }
  ) {
    this.config = config;
    this.db = db;
    this.logger = logger;
    this.chain = chain;
    this.forkChoice = forkChoice;
    this.pendingAttestations = new Map<BlockRootHex, Map<AttestationRootHex, Attestation>>();
  }

  public async receiveAttestation(attestation: Attestation): Promise<void> {
    const attestationHash = this.config.types.Attestation.hashTreeRoot(attestation);
    this.logger.info(`Received attestation ${toHexString(attestationHash)}`);
    try {
      const attestationSlot: Slot = attestation.data.slot;
      const state = await this.db.state.get(this.forkChoice.headStateRoot());
      if(attestationSlot + this.config.params.SLOTS_PER_EPOCH < state.slot) {
        this.logger.verbose(`Attestation ${toHexString(attestationHash)} is too old. Ignored.`);
        return;
      }
    } catch (e) {
      return;
    }
    const targetRoot = attestation.data.target.root;
    if (!await this.db.block.has(targetRoot.valueOf() as Uint8Array)) {
      this.chain.emit("unknownBlockRoot", targetRoot);
      this.addPendingAttestation(targetRoot, attestation, attestationHash);
      return;
    }
    const beaconBlockRoot = attestation.data.beaconBlockRoot;
    if (!await this.db.block.has(beaconBlockRoot.valueOf() as Uint8Array)) {
      this.chain.emit("unknownBlockRoot", beaconBlockRoot);
      this.addPendingAttestation(beaconBlockRoot, attestation, attestationHash);
      return;
    }
    try {
      await this.processAttestation(attestation, attestationHash);
    } catch (e) {
      this.logger.warn("Failed to process attestation. Reason: " + e.message);
    }
  }

  public async receiveBlock(signedBlock: SignedBeaconBlock): Promise<void> {
    // process block's attestations
    const attestations = signedBlock.message.body.attestations.valueOf() as Attestation[];
    await Promise.all(attestations.map((a) => this.receiveAttestation(a)));
    // process pending attestations due to this block
    const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(signedBlock.message);
    const blockPendingAttestations = this.pendingAttestations.get(toHexString(blockRoot)) ||
      new Map<AttestationRootHex, Attestation>();
    for (const [hash, attestation] of blockPendingAttestations) {
      await this.processAttestation(attestation, fromHexString(hash));
    }
    this.pendingAttestations.delete(toHexString(blockRoot));
  }

  public async processAttestation(attestation: Attestation, attestationHash: Root): Promise<void> {
    const justifiedCheckpoint = this.forkChoice.getJustified();
    const justifiedBlock = await this.db.block.get(justifiedCheckpoint.root.valueOf() as Uint8Array);
    const checkpointState = await this.db.state.get(justifiedBlock.message.stateRoot.valueOf() as Uint8Array);
    const currentSlot = getCurrentSlot(this.config, checkpointState.genesisTime);
    const currentEpoch = computeEpochAtSlot(this.config, currentSlot);
    const previousEpoch = currentEpoch > GENESIS_EPOCH ? currentEpoch - 1 : GENESIS_EPOCH;
    const target = attestation.data.target;
    assert([currentEpoch, previousEpoch].includes(target.epoch), "attestation is targeting too old epoch");
    assert(
      target.epoch === computeEpochAtSlot(this.config, attestation.data.slot),
      "attestation is not targeting current epoch"
    );
    assert(
      getCurrentSlot(this.config, checkpointState.genesisTime) >= computeStartSlotAtEpoch(this.config, target.epoch)
      , "Current slot less than this target epoch's start slot"
    );
    const block = await this.db.block.get(attestation.data.beaconBlockRoot.valueOf() as Uint8Array);
    assert(block.message.slot <= attestation.data.slot, "Attestation is for past block");

    const validators = getAttestingIndices(
      this.config, checkpointState, attestation.data, attestation.aggregationBits);
    const balances = validators.map((index) => checkpointState.balances[index]);
    for (let i = 0; i < validators.length; i++) {
      this.forkChoice.addAttestation(
        attestation.data.beaconBlockRoot.valueOf() as Uint8Array,
        validators[i],
        balances[i]
      );
    }
    this.logger.info(`Attestation ${toHexString(attestationHash)} passed to fork choice`);
    this.chain.emit("processedAttestation", attestation);
  }

  private addPendingAttestation(blockRoot: Root, attestation: Attestation, attestationHash: Root): void {
    const blockPendingAttestations = this.pendingAttestations.get(toHexString(blockRoot)) ||
      new Map<AttestationRootHex, Attestation>();
    blockPendingAttestations.set(toHexString(attestationHash), attestation);
    this.pendingAttestations.set(toHexString(blockRoot), blockPendingAttestations);
  }
}
