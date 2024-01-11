import {Epoch, bellatrix} from "@lodestar/types";
import {Api, ApiError, routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";

import {IClock, LoggerVc, batchItems} from "../util/index.js";
import {Metrics} from "../metrics.js";
import {ValidatorStore} from "./validatorStore.js";

const REGISTRATION_CHUNK_SIZE = 512;
/**
 * This service is responsible for registering validators to beacon node with the
 * proposer data (currently `feeRecipient`) so that it can issue advance fcUs to
 * the engine for building execution payload with transactions.
 *
 * This needs to be done every epoch because the BN will cache it at most for
 * two epochs.
 */
export function pollPrepareBeaconProposer(
  config: BeaconConfig,
  logger: LoggerVc,
  api: Api,
  clock: IClock,
  validatorStore: ValidatorStore,
  _metrics: Metrics | null
): void {
  async function prepareBeaconProposer(epoch: Epoch): Promise<void> {
    // Before bellatrix we don't need to update this data on bn/builder
    if (epoch < config.BELLATRIX_FORK_EPOCH - 1) return;

    // prepareBeaconProposer is not as time sensitive as attesting.
    // Poll indices first, then call api.validator.prepareBeaconProposer once
    await validatorStore.pollValidatorIndices().catch((e: Error) => {
      logger.error("Error on pollValidatorIndices for prepareBeaconProposer", {epoch}, e);
    });

    const indicesChunks = batchItems(validatorStore.getAllLocalIndices(), {batchSize: REGISTRATION_CHUNK_SIZE});

    for (const indices of indicesChunks) {
      try {
        const proposers = indices.map(
          (index): routes.validator.ProposerPreparationData => ({
            validatorIndex: String(index as number),
            feeRecipient: validatorStore.getFeeRecipientByIndex(index),
          })
        );
        ApiError.assert(await api.validator.prepareBeaconProposer(proposers));
        logger.debug("Registered proposers with beacon node", {epoch, count: proposers.length});
      } catch (e) {
        logger.error("Failed to register proposers with beacon node", {epoch}, e as Error);
      }
    }
  }

  clock.runEveryEpoch(prepareBeaconProposer);
}

/**
 * This service is responsible for registering validators with the mev builder as they
 * might prepare and keep ready the execution payloads of just registered validators.
 *
 * This needs to be done every epoch because the builder(s) will cache it at most for
 * two epochs.
 */
export function pollBuilderValidatorRegistration(
  config: BeaconConfig,
  logger: LoggerVc,
  api: Api,
  clock: IClock,
  validatorStore: ValidatorStore,
  _metrics: Metrics | null
): void {
  async function registerValidator(epoch: Epoch): Promise<void> {
    // Before bellatrix we don't need to update this data on bn/builder
    if (epoch < config.BELLATRIX_FORK_EPOCH - 1) return;
    const slot = epoch * SLOTS_PER_EPOCH;

    // registerValidator is not as time sensitive as attesting.
    // Poll indices first, then call api.validator.registerValidator once
    await validatorStore.pollValidatorIndices().catch((e: Error) => {
      logger.error("Error on pollValidatorIndices for registerValidator", {epoch}, e);
    });
    const pubkeyHexes = validatorStore
      .getAllLocalIndices()
      .map((index) => validatorStore.getPubkeyOfIndex(index))
      .filter(
        (pubkeyHex): pubkeyHex is string =>
          pubkeyHex !== undefined &&
          validatorStore.getBuilderSelectionParams(pubkeyHex).selection !==
            routes.validator.BuilderSelection.ExecutionOnly
      );

    if (pubkeyHexes.length > 0) {
      const pubkeyHexesChunks = batchItems(pubkeyHexes, {batchSize: REGISTRATION_CHUNK_SIZE});

      for (const pubkeyHexes of pubkeyHexesChunks) {
        try {
          const registrations = await Promise.all(
            pubkeyHexes.map((pubkeyHex): Promise<bellatrix.SignedValidatorRegistrationV1> => {
              const feeRecipient = validatorStore.getFeeRecipient(pubkeyHex);
              const gasLimit = validatorStore.getGasLimit(pubkeyHex);
              return validatorStore.getValidatorRegistration(pubkeyHex, {feeRecipient, gasLimit}, slot);
            })
          );
          ApiError.assert(await api.validator.registerValidator(registrations));
          logger.info("Published validator registrations to builder", {epoch, count: registrations.length});
        } catch (e) {
          logger.error("Failed to publish validator registrations to builder", {epoch}, e as Error);
        }
      }
    }
  }

  clock.runEveryEpoch(registerValidator);
}
