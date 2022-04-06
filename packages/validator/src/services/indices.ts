import {ValidatorIndex} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {Api} from "@chainsafe/lodestar-api";
import {ValidatorStore} from "./validatorStore.js";
import {batchItems} from "../util/batch.js";

/**
 * URLs have a limitation on size, adding an unbounded num of pubkeys will break the request.
 * For reasoning on the specific number see: https://github.com/ChainSafe/lodestar/pull/2730#issuecomment-866749083
 */
const PUBKEYS_PER_REQUEST = 10;

// To assist with readability
type PubkeyHex = string;

export class IndicesService {
  readonly index2pubkey = new Map<ValidatorIndex, PubkeyHex>();
  /** Indexed by pubkey in hex 0x prefixed */
  readonly pubkey2index = new Map<PubkeyHex, ValidatorIndex>();
  // Request indices once
  private pollValidatorIndicesPromise: Promise<ValidatorIndex[]> | null = null;

  constructor(
    private readonly logger: ILogger,
    private readonly api: Api,
    private readonly validatorStore: ValidatorStore
  ) {}

  /** Return all known indices from the validatorStore pubkeys */
  getAllLocalIndices(): ValidatorIndex[] {
    return Array.from(this.index2pubkey.keys());
  }

  /** Return true if `index` is active part of this validator client */
  hasValidatorIndex(index: ValidatorIndex): boolean {
    return this.index2pubkey.has(index);
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

  removeDutiesForKey(pubkey: PubkeyHex): void {
    for (const [key, value] of this.index2pubkey) {
      if (value === pubkey) {
        this.index2pubkey.delete(key);
      }
    }

    this.pubkey2index.delete(pubkey);
  }

  /** Iterate through all the voting pubkeys in the `ValidatorStore` and attempt to learn any unknown
      validator indices. Returns the new discovered indexes */
  private async pollValidatorIndicesInternal(): Promise<ValidatorIndex[]> {
    const pubkeysHex = this.validatorStore.votingPubkeys().filter((pubkey) => !this.pubkey2index.has(pubkey));

    if (pubkeysHex.length === 0) {
      return [];
    }

    // Query the remote BN to resolve a pubkey to a validator index.
    // support up to 1000 pubkeys per poll
    const pubkeysHexBatches = batchItems(pubkeysHex, {batchSize: PUBKEYS_PER_REQUEST});

    const newIndices: number[] = [];
    for (const pubkeysHexBatch of pubkeysHexBatches) {
      const validatorIndicesArr = await this.fetchValidatorIndices(pubkeysHexBatch);
      newIndices.push(...validatorIndicesArr);
    }
    this.logger.info("Discovered new validators", {count: newIndices.length});
    return newIndices;
  }

  private async fetchValidatorIndices(pubkeysHex: string[]): Promise<ValidatorIndex[]> {
    const validatorsState = await this.api.beacon.getStateValidators("head", {id: pubkeysHex});
    const newIndices = [];
    for (const validatorState of validatorsState.data) {
      const pubkeyHex = toHexString(validatorState.validator.pubkey);
      if (!this.pubkey2index.has(pubkeyHex)) {
        this.logger.debug("Discovered validator", {pubkey: pubkeyHex, index: validatorState.index});
        this.pubkey2index.set(pubkeyHex, validatorState.index);
        this.index2pubkey.set(validatorState.index, pubkeyHex);
        newIndices.push(validatorState.index);
      }
    }
    return newIndices;
  }
}
