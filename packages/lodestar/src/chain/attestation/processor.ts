import {fromHexString, toHexString} from "@chainsafe/ssz";
import {Attestation, AttestationRootHex, BlockRootHex, Root, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getCurrentSlot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {assert} from "@chainsafe/lodestar-utils";

import {IAttestationProcessor, IBeaconChain} from "./interface";
import {ILMDGHOST} from ".";
import {IBeaconDb} from "../db";
import {GENESIS_EPOCH} from "../constants";
import {ExtendedValidatorResult} from "../../network/gossip/constants";

export class AttestationProcessor implements IAttestationProcessor {
  private readonly config: IBeaconConfig;
  private db: IBeaconDb;
  private logger: ILogger;
  private chain: IBeaconChain;
  private forkChoice: ILMDGHOST;
  private pendingAttestations: Map<BlockRootHex, Map<AttestationRootHex, Attestation>>;

  public constructor(
    chain: IBeaconChain,
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

  /**
   * Runs fork choice attestation validation (method may take a long time to resolve and throw error)
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.2/specs/phase0/fork-choice.md#validate_on_attestation
   *
   * @param attestation
   */
  public async receiveAttestation(attestation: Attestation): Promise<void> {
    const attestationHash = this.config.types.Attestation.hashTreeRoot(attestation);
    const attestationLogContext  = {
      attestationHash: toHexString(attestationHash),
      target: attestation.data.target.epoch,
    };
    this.logger.info("Received attestation", attestationLogContext);
    const target = attestation.data.target;
    const currentSlot = getCurrentSlot(this.config, this.chain.getGenesisTime());
    const currentEpoch = computeEpochAtSlot(this.config, currentSlot);
    const previousEpoch = currentEpoch > GENESIS_EPOCH ? currentEpoch - 1 : GENESIS_EPOCH;
    if(target.epoch < previousEpoch) {
      this.logger.warn("Ignored attestation", {reason: "target too old", currentEpoch, ...attestationLogContext});
      return ExtendedValidatorResult.ignore;
    }
    if(target.epoch > currentEpoch) {
      this.logger.verbose(
        "Delaying attestation",
        {reason: "target ahead of current epooch", currentEpoch, ...attestationLogContext}
      );
      setTimeout(() => {
        this.receiveAttestation(attestation).catch();
      }, 3000);
      return ExtendedValidatorResult.ignore;
    }
    if(!this.forkChoice.hasBlock(target.root.valueOf() as Uint8Array)) {
      this.logger.verbose(
        "Adding attestation to pool",
        {reason: "missing target block", targetRoot: toHexString(target.root), ...attestationLogContext}
      );
      this.addPendingAttestation(target.root, attestation, attestationHash);
      return ExtendedValidatorResult.ignore;
    }
    const attestationBlock = this.forkChoice.getBlockSummaryByBlockRoot(
      attestation.data.beaconBlockRoot.valueOf() as Uint8Array
    );
    if(!attestationBlock) {
      this.logger.verbose(
        "Adding attestation to pool",
        {
          reason: "missing attestation block",
          beaconBlockRoot: toHexString(attestation.data.beaconBlockRoot),
          ...attestationLogContext
        }
      );
      this.addPendingAttestation(attestation.data.beaconBlockRoot, attestation, attestationHash);
      return ExtendedValidatorResult.ignore;
    }

    if(attestationBlock.slot > attestation.data.slot) {
      this.logger.warn("Ignored attestation", {reason: "attestation for future block", ...attestationLogContext});
      return ExtendedValidatorResult.ignore;
    }

    const targetSlot = computeStartSlotAtEpoch(this.config, target.epoch);
    const ancestor = this.forkChoice.getAncestor(attestation.data.beaconBlockRoot.valueOf() as Uint8Array, targetSlot);
    if(!this.config.types.Root.equals(target.root, ancestor)) {
      this.logger.warn(
        "Rejected attestation",
        {reason: "LMD vote must be consistent with FFG vote target", ...attestationLogContext}
      );
      return ExtendedValidatorResult.reject;
    }
    this.logger.verbose("Attestation passed forkchoice validation", attestationLogContext);
    try {
      return await this.processAttestation(attestation, attestationHash);
    } catch (e) {
      this.logger.warn("Attestation failed processing", {reason: e.message, ...attestationLogContext});
      return ExtendedValidatorResult.reject;
    }
  }

  public async receiveBlock(signedBlock: SignedBeaconBlock): Promise<void> {
    // process block's attestations
    const attestations = signedBlock.message.body.attestations;
    await Promise.all(Array.from(attestations).map((a) => this.receiveAttestation(a)));
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

  public async processAttestation(attestation: Attestation, attestationHash: Root): Promise<ExtendedValidatorResult> {
    const justifiedCheckpoint = this.forkChoice.getJustified();
    const currentSlot = this.forkChoice.headBlockSlot();
    const currentEpoch = computeEpochAtSlot(this.config, currentSlot);
    const justifiedBlock = this.forkChoice.getBlockSummaryByBlockRoot(
      justifiedCheckpoint.root.valueOf() as Uint8Array
    );
    if (!justifiedBlock) {
      // should not happen
      throw new Error(`Cannot find justified node of forkchoice, blockHash=${toHexString(justifiedCheckpoint.root)}`);
    }
    const previousEpoch = currentEpoch > GENESIS_EPOCH ? currentEpoch - 1 : GENESIS_EPOCH;
    const target = attestation.data.target;
    assert.true([previousEpoch, currentEpoch].includes(target.epoch),
      `attestation is targeting too old epoch ${target.epoch}, current=${currentEpoch}`
    );
    assert.equal(
      target.epoch, computeEpochAtSlot(this.config, attestation.data.slot),
      "attestation is not targeting current epoch"
    );
    const block = this.forkChoice.getBlockSummaryByBlockRoot(attestation.data.beaconBlockRoot.valueOf() as Uint8Array);
    assert.true(
      !!block,
      `The block of attestation data ${toHexString(attestation.data.beaconBlockRoot)} does not exist`
    );
    const targetSlot = computeStartSlotAtEpoch(this.config, target.epoch);
    const ancestor = this.forkChoice.getAncestor(attestation.data.beaconBlockRoot as Uint8Array, targetSlot);
    assert.true(
      ancestor && this.config.types.Root.equals(target.root, ancestor),
      "FFG and LMD vote must be consistent with each other");
    const stateCtx = await this.db.stateCache.get(block.stateRoot);
    assert.true(
      !!stateCtx,
      `Missing state context for attestation block with stateRoot ${toHexString(block.stateRoot)}`
    );
    const validators = stateCtx.epochCtx.getAttestingIndices(
      attestation.data,
      attestation.aggregationBits
    );
    const balances = validators.map((index) => stateCtx.state.balances[index]);
    for (let i = 0; i < validators.length; i++) {
      this.forkChoice.addAttestation(
        attestation.data.beaconBlockRoot.valueOf() as Uint8Array,
        validators[i],
        balances[i]
      );
    }
    this.logger.verbose(`Attestation ${toHexString(attestationHash)} passed to fork choice`);
    this.chain.emit("processedAttestation", attestation);
  }

  private addPendingAttestation(blockRoot: Root, attestation: Attestation, attestationHash: Root): void {
    this.chain.emit("unknownBlockRoot", blockRoot);
    const blockPendingAttestations = this.pendingAttestations.get(toHexString(blockRoot)) ||
      new Map<AttestationRootHex, Attestation>();
    blockPendingAttestations.set(toHexString(attestationHash), attestation);
    this.pendingAttestations.set(toHexString(blockRoot), blockPendingAttestations);
  }
}
