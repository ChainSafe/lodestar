import {ValidatorIndex} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {IApiClient} from "../api";
import {ValidatorStore} from "./validatorStore";

// To assist with readability
type PubkeyHex = string;

export class IndicesService {
  private readonly logger: ILogger;
  private readonly apiClient: IApiClient;
  private readonly validatorStore: ValidatorStore;
  /** Indexed by pubkey in hex 0x prefixed */
  private readonly pubkey2index = new Map<PubkeyHex, ValidatorIndex>();
  private readonly indices = new Set<ValidatorIndex>();
  // Request indices once
  private pollValidatorIndicesPromise: Promise<ValidatorIndex[]> | null = null;

  constructor(logger: ILogger, apiClient: IApiClient, validatorStore: ValidatorStore) {
    this.logger = logger;
    this.apiClient = apiClient;
    this.validatorStore = validatorStore;
  }

  /** Return all known indices from the validatorStore pubkeys */
  getAllLocalIndices(): ValidatorIndex[] {
    return Array.from(this.indices.values());
  }

  /** Return true if `index` is active part of this validator client */
  hasValidatorIndex(index: ValidatorIndex): boolean {
    return this.indices.has(index);
  }

  pollValidatorIndices(): Promise<ValidatorIndex[]> {
    // TODO: ADd comment why
    if (this.pollValidatorIndicesPromise) {
      return this.pollValidatorIndicesPromise;
    }

    this.pollValidatorIndicesPromise = this.pollValidatorIndicesInternal();
    // TODO this too
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
