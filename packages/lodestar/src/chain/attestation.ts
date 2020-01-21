import assert from "assert";
import {IAttestationProcessor, ChainEventEmitter} from "./interface";
import {ILMDGHOST} from ".";
import {Attestation, Slot, Root, BlockRootHex, AttestationRootHex, SignedBeaconBlock} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconDb} from "../db";
import {getCurrentSlot, computeEpochAtSlot, getAttestingIndices} from "@chainsafe/eth2.0-state-transition";
import {GENESIS_EPOCH} from "../constants";
import {ILogger} from  "@chainsafe/eth2.0-utils/lib/logger";
import {hashTreeRoot} from "@chainsafe/ssz";

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
    {config, db, logger}: {config: IBeaconConfig; db: IBeaconDb; logger: ILogger}
  ) {
    this.config = config;
    this.db = db;
    this.logger = logger;
    this.chain = chain;
    this.forkChoice = forkChoice;
    this.pendingAttestations = new Map<BlockRootHex, Map<AttestationRootHex, Attestation>>();
  }

  public async receiveAttestation(attestation: Attestation): Promise<void> {
    const attestationHash = hashTreeRoot(this.config.types.Attestation, attestation);
    this.logger.info(`Received attestation ${attestationHash.toString("hex")}`);
    try {
      const attestationSlot: Slot = attestation.data.slot;
      const headBlock = await this.db.block.get(this.forkChoice.head());
      const state = await this.db.state.get(headBlock.message.stateRoot);
      if(attestationSlot + this.config.params.SLOTS_PER_EPOCH < state.slot) {
        this.logger.verbose(`Attestation ${attestationHash.toString("hex")} is too old. Ignored.`);
        return;
      }
    } catch (e) {
      return;
    }
    const targetRoot = attestation.data.target.root;
    if (!await this.db.block.has(targetRoot)) {
      this.chain.emit("unknownBlockRoot", targetRoot);
      this.addPendingAttestation(targetRoot, attestation, attestationHash);
      return;
    }
    const beaconBlockRoot = attestation.data.beaconBlockRoot;
    if (!await this.db.block.has(beaconBlockRoot)) {
      this.chain.emit("unknownBlockRoot", beaconBlockRoot);
      this.addPendingAttestation(beaconBlockRoot, attestation, attestationHash);
      return;
    }
    await this.processAttestation(attestation, attestationHash);
  }

  public async receiveBlock(signedBlock: SignedBeaconBlock): Promise<void> {
    const blockRoot = hashTreeRoot(this.config.types.BeaconBlock, signedBlock.message);
    const blockPendingAttestations = this.pendingAttestations.get(blockRoot.toString("hex")) ||
      new Map<AttestationRootHex, Attestation>();
    for (const [hash, attestation] of blockPendingAttestations) {
      await this.processAttestation(attestation, Buffer.from(hash, "hex"));
    }
    this.pendingAttestations.delete(blockRoot.toString("hex"));
  }

  public async processAttestation (attestation: Attestation, attestationHash: Root): Promise<void> {
    const justifiedCheckpoint = this.forkChoice.getJustified();
    const justifiedBlock = await this.db.block.get(justifiedCheckpoint.root);
    const checkpointState = await this.db.state.get(justifiedBlock.message.stateRoot);
    const currentSlot = getCurrentSlot(this.config, checkpointState.genesisTime);
    const currentEpoch = computeEpochAtSlot(this.config, currentSlot);
    const previousEpoch = currentEpoch > GENESIS_EPOCH ? currentEpoch - 1 : GENESIS_EPOCH;
    const target = attestation.data.target;
    assert([currentEpoch, previousEpoch].includes(target.epoch));
    assert(target.epoch === computeEpochAtSlot(this.config, attestation.data.slot));
    const block = await this.db.block.get(attestation.data.beaconBlockRoot);
    assert(block.message.slot <= attestation.data.slot);

    const validators = getAttestingIndices(
      this.config, checkpointState, attestation.data, attestation.aggregationBits);
    const balances = validators.map((index) => checkpointState.balances[index]);
    for (let i = 0; i < validators.length; i++) {
      this.forkChoice.addAttestation(attestation.data.beaconBlockRoot, validators[i], balances[i]);
    }
    this.logger.info(`Attestation ${attestationHash.toString("hex")} passed to fork choice`);
    this.chain.emit("processedAttestation", attestation);
  }

  private addPendingAttestation(blockRoot: Root, attestation: Attestation, attestationHash: Root): void {
    const blockPendingAttestations = this.pendingAttestations.get(blockRoot.toString("hex")) ||
      new Map<AttestationRootHex, Attestation>();
    blockPendingAttestations.set(attestationHash.toString("hex"), attestation);
    this.pendingAttestations.set(blockRoot.toString("hex"), blockPendingAttestations);
  }
}
