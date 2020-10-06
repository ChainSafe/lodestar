import {readOnlyMap, toHexString} from "@chainsafe/ssz";
import {Attestation, AttestationRootHex, BlockRootHex, Root, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IAttestationJob} from "../interface";
import {AttestationProcessor} from "./processor";

/**
 * The AttestationPool is a cache of attestations that are pending processing.
 *
 * Pending attestations come in two varieties:
 * - attestations for unknown blocks
 * - attestations for future slots
 */
export class AttestationPool {
  private readonly config: IBeaconConfig;
  private processor: AttestationProcessor;

  /**
   * Attestations indexed by attestationRoot
   */
  private attestations: Map<AttestationRootHex, IAttestationJob>;
  /**
   * Attestations indexed by blockRoot, then attestationRoot
   */
  private attestationsByBlock: Map<BlockRootHex, Map<AttestationRootHex, IAttestationJob>>;
  /**
   * Attestations indexed by slot, then attestationRoot
   */
  private attestationsBySlot: Map<Slot, Map<AttestationRootHex, IAttestationJob>>;

  public constructor({config, processor}: {config: IBeaconConfig; processor: AttestationProcessor}) {
    this.config = config;
    this.processor = processor;

    this.attestations = new Map();
    this.attestationsByBlock = new Map();
    this.attestationsBySlot = new Map();
  }

  public putByBlock(blockRoot: Root, job: IAttestationJob): void {
    // put attestation in two indices:
    // attestations
    const attestationKey = this.getAttestationKey(job.attestation);
    this.attestations.set(attestationKey, job);
    // attestations by block
    const blockKey = toHexString(blockRoot);
    let attestationsAtBlock = this.attestationsByBlock.get(blockKey);
    if (!attestationsAtBlock) {
      attestationsAtBlock = new Map();
      this.attestationsByBlock.set(blockKey, attestationsAtBlock);
    }
    attestationsAtBlock.set(attestationKey, job);
  }

  public putBySlot(slot: Slot, job: IAttestationJob): void {
    // put attestation in two indices:
    // attestations
    const attestationKey = this.getAttestationKey(job.attestation);
    this.attestations.set(attestationKey, job);
    // attestations by slot
    let attestationsAtSlot = this.attestationsBySlot.get(slot);
    if (!attestationsAtSlot) {
      attestationsAtSlot = new Map();
      this.attestationsBySlot.set(slot, attestationsAtSlot);
    }
    attestationsAtSlot.set(attestationKey, job);
  }

  public remove(job: IAttestationJob): void {
    // remove block from three indices:
    // attestations
    const attestationKey = this.getAttestationKey(job.attestation);
    this.attestations.delete(attestationKey);
    // attestations by block
    // both target and beaconBlockRoot
    const targetKey = toHexString(job.attestation.data.target.root);
    const attestationsAtTarget = this.attestationsByBlock.get(targetKey);
    if (attestationsAtTarget) {
      attestationsAtTarget.delete(attestationKey);
      if (!attestationsAtTarget.size) {
        this.attestationsByBlock.delete(targetKey);
      }
    }
    const beaconBlockRootKey = toHexString(job.attestation.data.beaconBlockRoot);
    const attestationsAtBeaconBlockRoot = this.attestationsByBlock.get(beaconBlockRootKey);
    if (attestationsAtBeaconBlockRoot) {
      attestationsAtBeaconBlockRoot.delete(attestationKey);
      if (!attestationsAtBeaconBlockRoot.size) {
        this.attestationsByBlock.delete(beaconBlockRootKey);
      }
    }
    // attestations by slot
    const slotKey = job.attestation.data.slot;
    const attestationsAtSlot = this.attestationsBySlot.get(slotKey);
    if (attestationsAtSlot) {
      attestationsAtSlot.delete(attestationKey);
      if (!attestationsAtSlot.size) {
        this.attestationsBySlot.delete(slotKey);
      }
    }
  }

  public get(attestationRoot: Root): IAttestationJob | undefined {
    return this.attestations.get(toHexString(attestationRoot));
  }

  public has(attestationRoot: Root): boolean {
    return Boolean(this.get(attestationRoot));
  }

  public getByBlock(blockRoot: Root): IAttestationJob[] {
    return Array.from(this.attestationsByBlock.get(toHexString(blockRoot))?.values() ?? []);
  }

  public getBySlot(slot: Slot): IAttestationJob[] {
    return Array.from(this.attestationsBySlot.get(slot)?.values() ?? []);
  }

  public async onBlock(signedBlock: SignedBeaconBlock): Promise<void> {
    // process block's attestations
    const attestations = signedBlock.message.body.attestations;
    const jobs = readOnlyMap(attestations, (attestation) => ({
      attestation,
      // attestation signatures from blocks have already been verified
      validSignature: true,
    }));
    await Promise.all(jobs.map((job) => this.processor.processAttestationJob(job)));
    // process pending attestations due to this block
    const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(signedBlock.message);
    const key = toHexString(blockRoot);
    const attestationsAtBlock = Array.from(this.attestationsByBlock.get(key)?.values() ?? []);
    this.attestationsByBlock.delete(key);
    await Promise.all(
      attestationsAtBlock.map((job) => {
        this.remove(job);
        return this.processor.processAttestationJob(job);
      })
    );
  }

  public async onClockSlot(slot: Slot): Promise<void> {
    // Attestations can only affect the fork choice of subsequent slots.
    // Process the attestations in `slot - 1`, rather than `slot`
    const attestationsAtSlot = Array.from(this.attestationsBySlot.get(slot - 1)?.values() ?? []);
    this.attestationsBySlot.delete(slot - 1);
    await Promise.all(
      attestationsAtSlot.map((job) => {
        this.remove(job);
        return this.processor.processAttestationJob(job);
      })
    );
  }

  private getAttestationKey(attestation: Attestation): string {
    return toHexString(this.config.types.Attestation.hashTreeRoot(attestation));
  }
}
