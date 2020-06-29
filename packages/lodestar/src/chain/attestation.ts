import {fromHexString, toHexString} from "@chainsafe/ssz";
import {
  Attestation,
  AttestationRootHex,
  BeaconState,
  BlockRootHex,
  Root,
  SignedBeaconBlock,
  Slot
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getAttestingIndices
} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {assert} from "@chainsafe/lodestar-utils";

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

  public async  receiveAttestation(attestation: Attestation): Promise<void> {
    const attestationHash = this.config.types.Attestation.hashTreeRoot(attestation);
    this.logger.info(`Received attestation ${toHexString(attestationHash)}`);
    try {
      const attestationSlot: Slot = attestation.data.slot;
      const currentSlot = this.forkChoice.headBlockSlot();
      if(attestationSlot + this.config.params.SLOTS_PER_EPOCH < currentSlot) {
        this.logger.verbose(`Attestation ${toHexString(attestationHash)} is too old. Ignored.`);
        return;
      }
    } catch (e) {
      return;
    }
    const targetRoot = attestation.data.target.root;
    if (!this.forkChoice.hasBlock(targetRoot.valueOf() as Uint8Array)) {
      this.chain.emit("unknownBlockRoot", targetRoot);
      this.addPendingAttestation(targetRoot, attestation, attestationHash);
      return;
    }
    const beaconBlockRoot = attestation.data.beaconBlockRoot;
    if (!this.forkChoice.hasBlock(beaconBlockRoot.valueOf() as Uint8Array)) {
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
      try {
        await this.processAttestation(attestation, fromHexString(hash));
      } catch (e) {
        this.logger.warn("Failed to process attestation. Reason: " + e.message);
      }
    }
    this.pendingAttestations.delete(toHexString(blockRoot));
  }

  public async processAttestation(attestation: Attestation, attestationHash: Root): Promise<void> {
    const justifiedCheckpoint = this.forkChoice.getJustified();
    const currentSlot = this.forkChoice.headBlockSlot();
    const currentEpoch = computeEpochAtSlot(this.config, currentSlot);
    let checkpointState: BeaconState;
    if(justifiedCheckpoint.epoch > GENESIS_EPOCH) {
      const justifiedBlock =
        this.forkChoice.getBlockSummaryByBlockRoot(justifiedCheckpoint.root.valueOf() as Uint8Array);
      if (justifiedBlock) {
        checkpointState = await this.db.stateCache.get(justifiedBlock.stateRoot);
      } else {
        // should not happen
        throw new Error(`Cannot find justified node of forkchoice, blockHash=${toHexString(justifiedCheckpoint.root)}`);
      }
    } else {
      // should be genesis state
      checkpointState = await this.db.stateArchive.get(0);
    }
    const previousEpoch = currentEpoch > GENESIS_EPOCH ? currentEpoch - 1 : GENESIS_EPOCH;
    const target = attestation.data.target;
    assert([previousEpoch, currentEpoch].includes(target.epoch),
      `attestation is targeting too old epoch ${target.epoch}, current=${currentEpoch}`
    );
    assert(
      target.epoch === computeEpochAtSlot(this.config, attestation.data.slot),
      "attestation is not targeting current epoch"
    );
    const block = this.forkChoice.getBlockSummaryByBlockRoot(attestation.data.beaconBlockRoot.valueOf() as Uint8Array);
    assert(!!block, `The block of attestation data ${toHexString(attestation.data.beaconBlockRoot)} does not exist`);
    assert(block.slot <= attestation.data.slot, "Attestation is for past block");
    const targetSlot = computeStartSlotAtEpoch(this.config, target.epoch);
    const ancestor = this.forkChoice.getAncestor(attestation.data.beaconBlockRoot as Uint8Array, targetSlot);
    assert(
      ancestor && this.config.types.Root.equals(target.root, ancestor),
      "FFG and LMD vote must be consistent with each other");

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
