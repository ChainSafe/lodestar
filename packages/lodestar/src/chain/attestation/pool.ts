import {toHexString} from "@chainsafe/ssz";
import {Attestation, AttestationRootHex, BlockRootHex, Root, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {IAttestationProcessor, IBeaconChain} from "../interface";
import {IBeaconDb} from "../../db/api";
import {GENESIS_EPOCH} from "../../constants";
import {processAttestation} from "./processor";

export class AttestationProcessor implements IAttestationProcessor {
  private readonly config: IBeaconConfig;
  private db: IBeaconDb;
  private logger: ILogger;
  private chain: IBeaconChain;
  private forkChoice: IForkChoice;
  //using map inside map to ensure unique attestation
  private pendingBlockAttestations: Map<BlockRootHex, Map<AttestationRootHex, Attestation>>;
  private pendingSlotAttestations: Map<Slot, Map<AttestationRootHex, Attestation>>;

  public constructor(
    chain: IBeaconChain,
    {config, db, logger}: {config: IBeaconConfig; db: IBeaconDb; logger: ILogger}
  ) {
    this.config = config;
    this.db = db;
    this.logger = logger;
    this.chain = chain;
    this.forkChoice = chain.forkChoice;
    this.pendingBlockAttestations = new Map();
    this.pendingSlotAttestations = new Map();
  }

  public async start(): Promise<void> {
    //checks if attestation is waiting on specific slot
    this.chain.emitter.on("clock:slot", this.onNewSlot);
  }
  public async stop(): Promise<void> {
    this.chain.emitter.off("clock:slot", this.onNewSlot);
  }

  /**
   * Resolves quickly but attestation process might be delayed
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.2/specs/phase0/fork-choice.md#validate_on_attestation
   *
   * @param attestation
   */
  public async receiveAttestation(attestation: Attestation): Promise<void> {
    const attestationHash = this.config.types.Attestation.hashTreeRoot(attestation);
    const attestationLogContext = {
      attestationHash: toHexString(attestationHash),
      target: attestation.data.target.epoch,
    };
    this.logger.info("Attestation received to process pool", attestationLogContext);
    const target = attestation.data.target;
    const currentSlot = this.chain.clock.currentSlot;
    const currentEpoch = this.chain.clock.currentEpoch;
    const previousEpoch = currentEpoch > GENESIS_EPOCH ? currentEpoch - 1 : GENESIS_EPOCH;
    if (target.epoch < previousEpoch) {
      this.logger.warn("Attestation dropped from pool", {
        reason: "target too old",
        currentEpoch,
        ...attestationLogContext,
      });
    }
    if (target.epoch > currentEpoch) {
      this.logger.verbose("Delaying attestation", {
        reason: "target ahead of current epoch",
        currentEpoch,
        ...attestationLogContext,
      });
      return this.addPendingSlotAttestation(
        computeStartSlotAtEpoch(this.config, target.epoch),
        attestation,
        attestationHash
      );
    }
    for (const blockRoot of [target.root, attestation.data.beaconBlockRoot]) {
      if (!this.forkChoice.getBlock(blockRoot)) {
        this.logger.verbose("Delaying attestation", {
          reason: "missing either target or attestation block",
          blockRoot: toHexString(blockRoot),
          ...attestationLogContext,
        });
        this.addPendingBlockAttestation(blockRoot, attestation, attestationHash);
        return;
      }
    }
    if (currentSlot < attestation.data.slot + 1) {
      this.logger.verbose("Delaying attestation", {
        reason: "current slot less than attestation slot",
        currentSlot,
        attestationSlot: attestation.data.slot,
        ...attestationLogContext,
      });
      this.addPendingSlotAttestation(attestation.data.slot + 1, attestation, attestationHash);
      return;
    }
    //don't wait for this to resolve
    processAttestation(this.config, this.chain, this.logger, this.db, attestation).catch((e) => {
      this.logger.error("Error processing attestation", e);
    });
  }

  public async receiveBlock(signedBlock: SignedBeaconBlock): Promise<void> {
    // process block's attestations
    const attestations = signedBlock.message.body.attestations;
    // process one by one in order to cache checkpoit state
    for (const attestation of attestations) {
      await this.receiveAttestation(attestation);
    }
    // process pending attestations due to this block
    const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(signedBlock.message);
    const blockPendingAttestations =
      this.pendingBlockAttestations.get(toHexString(blockRoot)) || new Map<AttestationRootHex, Attestation>();
    for (const [_, attestation] of blockPendingAttestations) {
      try {
        await this.receiveAttestation(attestation);
      } catch (e) {
        this.logger.warn("Failed to process attestation. Reason: " + e.message);
      }
    }
    this.pendingBlockAttestations.delete(toHexString(blockRoot));
  }

  public getPendingBlockAttestations(blockRootHex: string): Attestation[] {
    return Array.from(this.pendingBlockAttestations.get(blockRootHex)?.values() ?? []);
  }

  public getPendingSlotAttestations(slot: Slot): Attestation[] {
    return Array.from(this.pendingSlotAttestations.get(slot)?.values() ?? []);
  }

  private addPendingBlockAttestation(blockRoot: Root, attestation: Attestation, attestationHash: Root): void {
    this.chain.emitter.emit("unknownBlockRoot", blockRoot);
    const blockPendingAttestations =
      this.pendingBlockAttestations.get(toHexString(blockRoot)) || new Map<AttestationRootHex, Attestation>();
    blockPendingAttestations.set(toHexString(attestationHash), attestation);
    this.pendingBlockAttestations.set(toHexString(blockRoot), blockPendingAttestations);
  }

  private addPendingSlotAttestation(slot: Slot, attestation: Attestation, attestationHash: Root): void {
    const blockPendingAttestations =
      this.pendingSlotAttestations.get(slot) ?? new Map<AttestationRootHex, Attestation>();
    blockPendingAttestations.set(toHexString(attestationHash), attestation);
    this.pendingSlotAttestations.set(slot, blockPendingAttestations);
  }

  private onNewSlot = async (slot: Slot): Promise<void> => {
    const pendingSlotAttestation = this.pendingSlotAttestations.get(slot) ?? new Map();
    for (const [_, attestation] of pendingSlotAttestation) {
      try {
        await this.receiveAttestation(attestation);
      } catch (e) {
        this.logger.warn("Failed to process attestation. Reason: " + e.message);
      }
    }
    this.pendingSlotAttestations.delete(slot);
  };
}
