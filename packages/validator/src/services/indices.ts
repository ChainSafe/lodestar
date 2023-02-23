import {ValidatorIndex} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {toHexString} from "@chainsafe/ssz";
import {Api, ApiError} from "@lodestar/api";
import {routes} from "@lodestar/api";
import {batchItems} from "../util/index.js";
import {Metrics} from "../metrics.js";

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

  constructor(private readonly logger: Logger, private readonly api: Api, private readonly metrics: Metrics | null) {
    if (metrics) {
      metrics.indices.addCollect(() => metrics.indices.set(this.index2pubkey.size));
    }
  }

  get indexCount(): number {
    return this.index2pubkey.size;
  }

  /** Returns the validator index for a given validator pubkey */
  getValidatorIndex(pubKey: PubkeyHex): ValidatorIndex | undefined {
    return this.pubkey2index.get(pubKey);
  }

  /** Return all known indices from the validatorStore pubkeys */
  getAllLocalIndices(): ValidatorIndex[] {
    return Array.from(this.index2pubkey.keys());
  }

  /** Return true if `index` is active part of this validator client */
  hasValidatorIndex(index: ValidatorIndex): boolean {
    return this.index2pubkey.has(index);
  }

  pollValidatorIndices(pubkeysHex: PubkeyHex[]): Promise<ValidatorIndex[]> {
    // Ensures pollValidatorIndicesInternal() is not called more than once at the same time.
    // AttestationDutiesService, SyncCommitteeDutiesService and DoppelgangerService will call this function at the same time, so this will
    // cache the promise and return it to the second caller, preventing calling the API twice for the same data.
    if (this.pollValidatorIndicesPromise) {
      return this.pollValidatorIndicesPromise;
    }

    this.pollValidatorIndicesPromise = this.pollValidatorIndicesInternal(pubkeysHex);
    // Once the pollValidatorIndicesInternal() resolves or rejects null the cached promise so it can be called again.
    this.pollValidatorIndicesPromise.finally(() => {
      this.pollValidatorIndicesPromise = null;
    });
    return this.pollValidatorIndicesPromise;
  }

  removeForKey(pubkey: PubkeyHex): boolean {
    for (const [index, value] of this.index2pubkey) {
      if (value === pubkey) {
        this.index2pubkey.delete(index);
      }
    }
    return this.pubkey2index.delete(pubkey);
  }

  /** Iterate through all the voting pubkeys in the `ValidatorStore` and attempt to learn any unknown
      validator indices. Returns the new discovered indexes */
  private async pollValidatorIndicesInternal(pubkeysHex: PubkeyHex[]): Promise<ValidatorIndex[]> {
    const pubkeysHexToDiscover = pubkeysHex.filter((pubkey) => !this.pubkey2index.has(pubkey));

    if (pubkeysHexToDiscover.length === 0) {
      return [];
    }

    // Query the remote BN to resolve a pubkey to a validator index.
    // support up to 1000 pubkeys per poll
    const pubkeysHexBatches = batchItems(pubkeysHexToDiscover, {batchSize: PUBKEYS_PER_REQUEST});

    const newIndices: number[] = [];
    for (const pubkeysHexBatch of pubkeysHexBatches) {
      const validatorIndicesArr = await this.fetchValidatorIndices(pubkeysHexBatch);
      newIndices.push(...validatorIndicesArr);
    }

    this.metrics?.discoveredIndices.inc(newIndices.length);

    return newIndices;
  }

  private async fetchValidatorIndices(pubkeysHex: string[]): Promise<ValidatorIndex[]> {
    const res = await this.api.beacon.getStateValidators("head", {id: pubkeysHex});
    ApiError.assert(res, "Can not fetch state validators from beacon node");

    const newIndices = [];

    const allValidators = new Map<routes.beacon.ValidatorStatus, routes.beacon.ValidatorResponse[]>();

    for (const validatorState of res.response.data) {
      // Group all validators by status
      if (!allValidators.has(validatorState.status)) {
        allValidators.set(validatorState.status, [validatorState]);
      } else {
        allValidators.get(validatorState.status)?.push(validatorState);
      }

      const pubkeyHex = toHexString(validatorState.validator.pubkey);
      if (!this.pubkey2index.has(pubkeyHex)) {
        this.logger.debug("Validator exists in beacon chain", {
          validatorIndex: validatorState.index,
          pubkey: pubkeyHex,
        });
        this.pubkey2index.set(pubkeyHex, validatorState.index);
        this.index2pubkey.set(validatorState.index, pubkeyHex);
        newIndices.push(validatorState.index);
      }
    }

    logValidatorStatuses(allValidators, this.logger);

    return newIndices;
  }
}

function logValidatorStatuses(
  allValidators: Map<routes.beacon.ValidatorStatus, routes.beacon.ValidatorResponse[]>,
  logger: Logger
): void {
  const loggedValidatorStates: {[key: string]: routes.beacon.ValidatorStatus[]} = {
    "Validator activated": ["active"],
    "Validator pending": ["pending_initialized", "pending_queued"],
    "Validator withdrawn": ["withdrawal_done"],
    "Validator exited": ["exited_slashed", "exited_unslashed"],
  };

  for (const [message, statuses] of Object.entries(loggedValidatorStates)) {
    for (const validatorState of getValidatorStatesByStatuses(statuses, allValidators)) {
      logger.info(message, {
        pubkey: toHexString(validatorState.validator.pubkey),
        index: validatorState.index,
      });
    }
  }

  logger.info("Validator statuses", {
    active: allValidators.get("active")?.length ?? 0,
    pending: getValidatorStatesByStatuses(loggedValidatorStates["Validator pending"], allValidators)?.length ?? 0,
    exited: getValidatorStatesByStatuses(loggedValidatorStates["Validator exited"], allValidators)?.length ?? 0,
    withdrawn: getValidatorStatesByStatuses(loggedValidatorStates["Validator withdrawn"], allValidators)?.length ?? 0,
    total: allValidators.size,
  });
}

function getValidatorStatesByStatuses(
  statuses: routes.beacon.ValidatorStatus[],
  allValidators: Map<routes.beacon.ValidatorStatus, routes.beacon.ValidatorResponse[]>
): routes.beacon.ValidatorResponse[] {
  return statuses.reduce((validatorStates, status) => {
    const validators = allValidators.get(status);
    if (validators) {
      validatorStates.push(...validators);
    }
    return validatorStates;
  }, [] as routes.beacon.ValidatorResponse[]);
}
