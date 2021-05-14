import {ValidatorIndex} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {IApiClient} from "../api";
import {ValidatorStore} from "./validatorStore";

// To assist with readability
type PubkeyHex = string;

export class IndicesService {
  /** Indexed by pubkey in hex 0x prefixed */
  private readonly pubkey2index = new Map<PubkeyHex, ValidatorIndex>();
  private readonly indices = new Set<ValidatorIndex>();
  // Request indices once
  private pollValidatorIndicesPromise: Promise<ValidatorIndex[]> | null = null;

  constructor(
    private readonly logger: ILogger,
    private readonly apiClient: IApiClient,
    private readonly validatorStore: ValidatorStore
  ) {}

  /** Return all known indices from the validatorStore pubkeys */
  getAllLocalIndices(): ValidatorIndex[] {
    return Array.from(this.indices.values());
  }

  /** Return true if `index` is active part of this validator client */
  hasValidatorIndex(index: ValidatorIndex): boolean {
    return this.indices.has(index);
  }

  pollValidatorIndices(): Promise<ValidatorIndex[]> {
    // Ensures pollValidatorIndicesInternal() is not called more than once at the same time.
    // AttestationDutiesService and SyncCommitteeDutiesService will call this function at the same time, so this will
    // cache the promise and return it to the second caller, preventing calling the API twice for the same data.
    if (this.pollValidatorIndicesPromise) {
      return this.pollValidatorIndicesPromise;
    }

    this.pollValidatorIndicesPromise = this.pollValidatorIndicesInternal();
    // Once the pollValidatorIndicesInternal() resolves or rejects null the cached promise so it can be called again.
    this.pollValidatorIndicesPromise.finally(() => {
      this.pollValidatorIndicesPromise = null;
    });
    return this.pollValidatorIndicesPromise;
  }

  /** Iterate through all the voting pubkeys in the `ValidatorStore` and attempt to learn any unknown
      validator indices. Returns the new discovered indexes */
  private async pollValidatorIndicesInternal(): Promise<ValidatorIndex[]> {
    const pubkeysToPoll = this.validatorStore
      .votingPubkeys()
      .filter((pubkey) => !this.pubkey2index.has(toHexString(pubkey)));

    if (pubkeysToPoll.length === 0) {
      return [];
    }

    // Query the remote BN to resolve a pubkey to a validator index.
    const validatorsState = await this.apiClient.beacon.state.getStateValidators("head", {indices: pubkeysToPoll});

    const newIndices = [];
    for (const validatorState of validatorsState) {
      const pubkeyHex = toHexString(validatorState.validator.pubkey);
      if (!this.pubkey2index.has(pubkeyHex)) {
        this.logger.debug("Discovered validator", {pubkey: pubkeyHex, index: validatorState.index});
        this.pubkey2index.set(pubkeyHex, validatorState.index);
        this.indices.add(validatorState.index);
        newIndices.push(validatorState.index);
      }
    }

    return newIndices;
  }
}
