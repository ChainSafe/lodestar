import {ValidatorIndex} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {Api} from "@chainsafe/lodestar-api";
import {ValidatorStore} from "./validatorStore";

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
    // support up to 1000 pubkeys per poll
    const pubkeysHex = pubkeysToPoll.map((pubkey) => toHexString(pubkey)).slice(0, MAX_PUBKEYS_PER_POLL);
    const batches = pubkeysToBatches(pubkeysHex);

    const newIndicesArr = [];
    for (const batch of batches) {
      const validatorIndicesArr = await Promise.all(batch.map(this.getIndicesPerHttpRequest));
      newIndicesArr.push(...validatorIndicesArr.flat());
    }
    const newIndices = newIndicesArr.flat();
    this.logger.info("Discovered new validators", {count: newIndices.length});
    return newIndices;
  }

  private getIndicesPerHttpRequest = async (pubkeysHex: string[]): Promise<ValidatorIndex[]> => {
    const validatorsState = await this.api.beacon.getStateValidators("head", {indices: pubkeysHex});
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
  };
}

type Batch = string[][];
const PUBKEYS_PER_REQUEST = 10;
const REQUESTS_PER_BATCH = 5;
const MAX_PUBKEYS_PER_POLL = 5 * PUBKEYS_PER_REQUEST * REQUESTS_PER_BATCH;

/**
 * Divide pubkeys into batches, each batch contains at most 5 http requests,
 * each request can work on at most 40 pubkeys.
 * @param pubkeysHex
 */
export function pubkeysToBatches(
  pubkeysHex: string[],
  maxPubkeysPerRequest: number = PUBKEYS_PER_REQUEST,
  maxRequesPerBatch: number = REQUESTS_PER_BATCH
): Batch[] {
  if (!pubkeysHex || pubkeysHex.length === 0) {
    return [[[]]];
  }
  const batches: Batch[] = [];

  const pubkeysPerBatch = maxPubkeysPerRequest * maxRequesPerBatch;
  let batch: Batch = [];
  let pubkeysPerRequest: string[];
  for (let i = 0; i < pubkeysHex.length; i += maxPubkeysPerRequest) {
    if (i % pubkeysPerBatch === 0) {
      batch = [];
      batches.push(batch);
    }
    if (i % maxPubkeysPerRequest === 0) {
      pubkeysPerRequest = pubkeysHex.slice(i, Math.min(i + maxPubkeysPerRequest, pubkeysHex.length));
      batch.push(pubkeysPerRequest);
    }
  }
  return batches;
}
