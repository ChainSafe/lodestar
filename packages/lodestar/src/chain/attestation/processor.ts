import {toHexString} from "@chainsafe/ssz";
import {Attestation, AttestationRootHex, BlockRootHex, Root, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getCurrentSlot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {ILMDGHOST} from "../forkChoice";
import {getAttestationPreState} from "../../network/gossip/utils";
import {IAttestationProcessor, IBeaconChain} from "../interface";
import {IBeaconDb} from "../../db/api";
import {GENESIS_EPOCH} from "../../constants";
import {isValidIndexedAttestation} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block/isValidIndexedAttestation";

export class AttestationProcessor implements IAttestationProcessor {
  private readonly config: IBeaconConfig;
  private db: IBeaconDb;
  private logger: ILogger;
  private chain: IBeaconChain;
  private forkChoice: ILMDGHOST;
  //using map inside map to ensure unique attestation
  private pendingBlockAttestations: Map<BlockRootHex, Map<AttestationRootHex, Attestation>>;
  private pendingSlotAttestations: Map<Slot, Map<AttestationRootHex, Attestation>>;

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
    this.pendingBlockAttestations = new Map();
    this.pendingSlotAttestations = new Map();
  }

  public async start(): Promise<void> {
    //checks if attestation is waiting on specific slot
    this.chain.clock.onNewSlot(this.onNewSlot);
  }
  public async stop(): Promise<void> {
    this.chain.clock.unsubscribeFromNewSlot(this.onNewSlot);
  }

  /**
   * Resolves quickly but attestation process might be delayed
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
    this.logger.info("Attestation received to process pool", attestationLogContext);
    const target = attestation.data.target;
    const currentSlot = getCurrentSlot(this.config, this.chain.getGenesisTime());
    const currentEpoch = computeEpochAtSlot(this.config, currentSlot);
    const previousEpoch = currentEpoch > GENESIS_EPOCH ? currentEpoch - 1 : GENESIS_EPOCH;
    if(target.epoch < previousEpoch) {
      this.logger.warn(
        "Attestation dropped from pool",
        {reason: "target too old", currentEpoch, ...attestationLogContext}
      );
    }
    if(target.epoch > currentEpoch) {
      this.logger.verbose(
        "Delaying attestation",
        {reason: "target ahead of current epoch", currentEpoch, ...attestationLogContext}
      );
      return this.addPendingSlotAttestation(
        computeStartSlotAtEpoch(this.config, target.epoch),
        attestation,
        attestationHash
      );
    }
    for(const blockRoot of [target.root, attestation.data.beaconBlockRoot]) {
      if(!this.forkChoice.getBlockSummaryByBlockRoot(blockRoot.valueOf() as Uint8Array)) {
        this.logger.verbose(
          "Delaying attestation",
          {
            reason: "missing either target or attestation block",
            blockRoot: toHexString(blockRoot),
            ...attestationLogContext
          }
        );
        this.addPendingBlockAttestation(blockRoot, attestation, attestationHash);
        return;
      }
    }
    if(currentSlot < attestation.data.slot + 1) {
      this.logger.verbose(
        "Delaying attestation",
        {
          reason: "current slot less than attestation slot",
          currentSlot,
          attestationSlot: attestation.data.slot,
          ...attestationLogContext
        }
      );
      this.addPendingSlotAttestation(attestation.data.slot + 1, attestation, attestationHash);
      return;
    }
    //don't wait for this to resolve
    void this.processAttestation(attestation, attestationHash);
  }

  public async receiveBlock(signedBlock: SignedBeaconBlock): Promise<void> {
    // process block's attestations
    const attestations = signedBlock.message.body.attestations;
    await Promise.all(Array.from(attestations).map((a) => this.receiveAttestation(a)));
    // process pending attestations due to this block
    const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(signedBlock.message);
    const blockPendingAttestations = this.pendingBlockAttestations.get(toHexString(blockRoot)) ||
      new Map<AttestationRootHex, Attestation>();
    for (const [_, attestation] of blockPendingAttestations) {
      try {
        await this.receiveAttestation(attestation);
      } catch (e) {
        this.logger.warn("Failed to process attestation. Reason: " + e.message);
      }
    }
    this.pendingBlockAttestations.delete(toHexString(blockRoot));
  }

  private async processAttestation(attestation: Attestation, attestationHash: Root): Promise<void> {
    const target = attestation.data.target;
    //LMD vote must be consistent with FFG vote target
    const targetSlot = computeStartSlotAtEpoch(this.config, target.epoch);
    if(!this.config.types.Root.equals(
      target.root,
      this.forkChoice.getAncestor(attestation.data.beaconBlockRoot.valueOf() as Uint8Array, targetSlot)
    )) {
      this.logger.verbose(
        "Dropping attestation from processing",
        {reason: "attestation ancensor isnt target root", attestationHash: toHexString(attestationHash)}
      );
      return;
    }

    const attestationPreState = await getAttestationPreState(this.config, this.chain, this.db, target);
    if(!attestationPreState) {
      //should not happen
      return;
    }
    await this.db.checkpointStateCache.add(target, attestationPreState);
    const indexedAttestation = attestationPreState.epochCtx.getIndexedAttestation(attestation);
    //TODO: we could signal to skip this in case it came from validated from gossip or from block
    //we need to check this again, because gossip validation might put it in pool before it validated signature
    if(!isValidIndexedAttestation(attestationPreState.epochCtx, attestationPreState.state, indexedAttestation, true)) {
      this.logger.verbose(
        "Dropping attestation from processing",
        {reason: "invalid indexed attestation", attestationHash: toHexString(attestationHash)}
      );
      return;
    }
    const validators = attestationPreState.epochCtx.getAttestingIndices(
      attestation.data,
      attestation.aggregationBits
    );
    const balances = validators.map((index) => attestationPreState.state.balances[index]);
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

  private addPendingBlockAttestation(blockRoot: Root, attestation: Attestation, attestationHash: Root): void {
    this.chain.emit("unknownBlockRoot", blockRoot);
    const blockPendingAttestations = this.pendingBlockAttestations.get(toHexString(blockRoot)) ||
      new Map<AttestationRootHex, Attestation>();
    blockPendingAttestations.set(toHexString(attestationHash), attestation);
    this.pendingBlockAttestations.set(toHexString(blockRoot), blockPendingAttestations);
  }

  private addPendingSlotAttestation(slot: Slot, attestation: Attestation, attestationHash: Root): void {
    const blockPendingAttestations = this.pendingSlotAttestations.get(slot) ??
      new Map<AttestationRootHex, Attestation>();
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
