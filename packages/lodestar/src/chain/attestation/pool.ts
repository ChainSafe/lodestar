import {toHexString} from "@chainsafe/ssz";
import {phase0, AttestationRootHex, BlockRootHex, Root, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IAttestationJob} from "../interface";

/**
 * The AttestationPool is a cache of attestations that are pending processing.
 *
 * Pending attestations come in two varieties:
 * - attestations for unknown blocks
 * - attestations for future slots
 */
export class AttestationPool {
  private readonly config: IBeaconConfig;
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

  constructor({config}: {config: IBeaconConfig}) {
    this.config = config;

    this.attestations = new Map<string, IAttestationJob>();
    this.attestationsByBlock = new Map<string, Map<string, IAttestationJob>>();
    this.attestationsBySlot = new Map<number, Map<string, IAttestationJob>>();
  }

  putByBlock(blockRoot: Root, job: IAttestationJob): void {
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

  putBySlot(slot: Slot, job: IAttestationJob): void {
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

  remove(job: IAttestationJob): void {
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

  get(attestationRoot: Root): IAttestationJob | undefined {
    return this.attestations.get(toHexString(attestationRoot));
  }

  has(attestationRoot: Root): boolean {
    return Boolean(this.get(attestationRoot));
  }

  getByBlock(blockRoot: Root): IAttestationJob[] {
    return Array.from(this.attestationsByBlock.get(toHexString(blockRoot))?.values() ?? []);
  }

  getBySlot(slot: Slot): IAttestationJob[] {
    return Array.from(this.attestationsBySlot.get(slot)?.values() ?? []);
  }

  private getAttestationKey(attestation: phase0.Attestation): string {
    return toHexString(this.config.types.phase0.Attestation.hashTreeRoot(attestation));
  }
}
