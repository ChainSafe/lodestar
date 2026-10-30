import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {ForkPostElectra, ForkPreElectra, isForkPostElectra, isForkPostGloas} from "@lodestar/params";
import {isStatePostAltair} from "@lodestar/state-transition";
import {Epoch, SingleAttestation, isElectraAttestation, ssz, sszTypesFor} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {
  AttestationError,
  AttestationErrorCode,
  GossipAction,
  PayloadAttestationError,
  PayloadAttestationErrorCode,
  SyncCommitteeError,
} from "../../../../chain/errors/index.js";
import {toElectraSingleAttestation} from "../../../../chain/validation/index.js";
import {OpSource} from "../../../../chain/validatorMonitor.js";
import {validateGossipFnRetryUnknownRoot} from "../../../../network/processor/gossipHandlers.js";
import {ApiError, FailureList, IndexedError} from "../../errors.js";
import {ApiModules} from "../../types.js";

export function getBeaconPoolApi({
  chain,
  logger,
  metrics,
  network,
}: Pick<ApiModules, "chain" | "logger" | "metrics" | "network">): ApplicationMethods<routes.beacon.pool.Endpoints> {
  return {
    async getPoolAttestationsV2({slot, committeeIndex}) {
      // Already filtered by slot
      let attestations = [
        ...chain.validationEngine.getPooledAggregates(slot),
        ...chain.validationEngine.getPooledAttestations(slot),
      ];
      const fork = chain.config.getForkName(slot ?? attestations[0]?.data.slot ?? chain.clock.currentSlot);
      const isPostElectra = isForkPostElectra(fork);

      attestations = attestations.filter((attestation) =>
        isPostElectra ? isElectraAttestation(attestation) : !isElectraAttestation(attestation)
      );

      if (committeeIndex !== undefined) {
        attestations = attestations.filter((attestation) =>
          isElectraAttestation(attestation)
            ? attestation.committeeBits.get(committeeIndex)
            : committeeIndex === attestation.data.index
        );
      }

      return {data: attestations, meta: {version: fork}};
    },

    async getPoolPayloadAttestations({slot}) {
      const fork = chain.config.getForkName(slot ?? chain.clock.currentSlot);
      if (!isForkPostGloas(fork)) {
        throw new ApiError(400, `Payload attestation pool is not supported before Gloas fork=${fork}`);
      }

      return {data: chain.validationEngine.getPooledPayloadAttestations(slot), meta: {version: fork}};
    },

    async getPoolAttesterSlashingsV2() {
      const fork = chain.config.getForkName(chain.clock.currentSlot);
      return {data: chain.validationEngine.getPooledAttesterSlashings(), meta: {version: fork}};
    },

    async getPoolProposerSlashings() {
      return {data: chain.validationEngine.getPooledProposerSlashings()};
    },

    async getPoolVoluntaryExits() {
      return {data: chain.validationEngine.getPooledVoluntaryExits()};
    },

    async getPoolBLSToExecutionChanges() {
      return {data: chain.validationEngine.getPooledBlsToExecutionChanges()};
    },

    async submitPoolAttestationsV2({signedAttestations}) {
      const fork = chain.config.getForkName(chain.clock.currentSlot);
      const seenTimestampSec = Date.now() / 1000;
      const failures: FailureList = [];
      // api attestation has high priority, we allow them to be added to pool even when it's late
      // this is to prevent "No aggregated attestation for slot" issue
      // see https://github.com/ChainSafe/lodestar/issues/7548
      const priority = true;

      await Promise.all(
        signedAttestations.map(async (attestation, i) => {
          try {
            const validateFn = () =>
              chain.validationEngine.validateApiAttestation(fork, {attestation, serializedData: null});
            const {slot, beaconBlockRoot} = attestation.data;
            // when a validator is configured with multiple beacon node urls, this attestation data may come from another beacon node
            // and the block hasn't been in our forkchoice since we haven't seen / processing that block
            // see https://github.com/ChainSafe/lodestar/issues/5098
            const validationResult = await validateGossipFnRetryUnknownRoot(
              validateFn,
              network,
              chain,
              slot,
              beaconBlockRoot
            );
            const {indexedAttestation, subnet} = validationResult;

            // `is_aggregator` only covers aggregating what we receive on the subnet via gossip, not what
            // a validator client hands us directly, see https://github.com/ChainSafe/lodestar/issues/7548.
            // A pool insertion failure is logged by the engine and must not stop us from publishing a validated
            // attestation, which the route requires us to do.
            const insertOutcome = chain.validationEngine.importAttestation(validationResult, {
              addToPool: true,
              addToForkChoice: false,
              priority,
            });
            if (insertOutcome !== null) {
              metrics?.opPool.attestationPool.apiInsertOutcome.inc({insertOutcome});
            }

            if (isForkPostElectra(fork)) {
              chain.emitter.emit(
                routes.events.EventType.singleAttestation,
                attestation as SingleAttestation<ForkPostElectra>
              );
            } else {
              chain.emitter.emit(routes.events.EventType.attestation, attestation as SingleAttestation<ForkPreElectra>);
              chain.emitter.emit(
                routes.events.EventType.singleAttestation,
                toElectraSingleAttestation(
                  attestation as SingleAttestation<ForkPreElectra>,
                  indexedAttestation.attestingIndices[0]
                )
              );
            }

            const sentPeers = await network.publishBeaconAttestation(attestation, subnet);
            chain.validatorMonitor?.onPoolSubmitUnaggregatedAttestation(
              seenTimestampSec,
              indexedAttestation,
              subnet,
              sentPeers
            );
          } catch (e) {
            const logCtx = {slot: attestation.data.slot, index: attestation.data.index};

            if (e instanceof AttestationError && e.type.code === AttestationErrorCode.ATTESTATION_ALREADY_KNOWN) {
              logger.debug("Ignoring known attestation", logCtx);
              // Attestations might already be published by another node as part of a fallback setup or DVT cluster
              // and can reach our node by gossip before the api. The error can be ignored and should not result in a 500 response.
              return;
            }

            failures.push({index: i, message: (e as Error).message});
            logger.verbose(`Error on submitPoolAttestations [${i}]`, logCtx, e as Error);
            if (e instanceof AttestationError && e.action === GossipAction.REJECT) {
              chain.persistInvalidSszValue(sszTypesFor(fork).SingleAttestation, attestation, "api_reject");
            }
          }
        })
      );

      if (failures.length > 0) {
        throw new IndexedError("Error processing attestations", failures);
      }
    },

    async submitPoolAttesterSlashingsV2({attesterSlashing}) {
      const verifiedDomains = await chain.validationEngine.validateApiAttesterSlashing(attesterSlashing);
      const fork = chain.config.getForkName(Number(attesterSlashing.attestation1.data.slot));
      chain.validationEngine.importAttesterSlashing(fork, attesterSlashing, verifiedDomains, {addToForkChoice: false});
      await network.publishAttesterSlashing(attesterSlashing);
    },

    async submitPoolProposerSlashings({proposerSlashing}) {
      const verifiedDomain = await chain.validationEngine.validateApiProposerSlashing(proposerSlashing);
      chain.validationEngine.importProposerSlashing(proposerSlashing, verifiedDomain);
      await network.publishProposerSlashing(proposerSlashing);
    },

    async submitPoolVoluntaryExit({signedVoluntaryExit}) {
      const result = await chain.validationEngine.validateApiVoluntaryExit(signedVoluntaryExit);

      if (result.status === "deferred") {
        const currentEpoch = chain.clock.currentEpoch;
        const inserted = chain.validationEngine.deferVoluntaryExit(signedVoluntaryExit, result.validity, currentEpoch);
        if (!inserted) {
          throw new ApiError(400, "Deferred voluntary exit pool is full or already contains this validator");
        }
        logger.info("Voluntary exit deferred until transient conditions are met", {
          validatorIndex: signedVoluntaryExit.message.validatorIndex,
          reason: result.validity,
        });
        return;
      }

      chain.validationEngine.importVoluntaryExit(signedVoluntaryExit);
      chain.emitter.emit(routes.events.EventType.voluntaryExit, signedVoluntaryExit);
      await network.publishVoluntaryExit(signedVoluntaryExit);
    },

    async submitPoolBLSToExecutionChange({blsToExecutionChanges}) {
      const failures: FailureList = [];

      await Promise.all(
        blsToExecutionChanges.map(async (blsToExecutionChange, i) => {
          try {
            // Ignore even if the change exists and reprocess
            await chain.validationEngine.validateApiBlsToExecutionChange(blsToExecutionChange);
            const preCapella = chain.clock.currentEpoch < chain.config.CAPELLA_FORK_EPOCH;
            chain.validationEngine.importBlsToExecutionChange(blsToExecutionChange, {preCapella});

            chain.emitter.emit(routes.events.EventType.blsToExecutionChange, blsToExecutionChange);

            if (!preCapella) {
              await network.publishBlsToExecutionChange(blsToExecutionChange);
            }
          } catch (e) {
            failures.push({index: i, message: (e as Error).message});
            logger.verbose(
              `Error on submitPoolBLSToExecutionChange [${i}]`,
              {validatorIndex: blsToExecutionChange.message.validatorIndex},
              e as Error
            );
          }
        })
      );

      if (failures.length > 0) {
        throw new IndexedError("Error processing BLS to execution changes", failures);
      }
    },

    async submitPayloadAttestationMessages({payloadAttestationMessages}) {
      const seenTimestampSec = Date.now() / 1000;
      const failures: FailureList = [];

      await Promise.all(
        payloadAttestationMessages.map(async (payloadAttestationMessage, i) => {
          try {
            const validateFn = () =>
              chain.validationEngine.validateApiPayloadAttestationMessage(payloadAttestationMessage);
            const {slot, beaconBlockRoot} = payloadAttestationMessage.data;
            const validationResult = await validateGossipFnRetryUnknownRoot(
              validateFn,
              network,
              chain,
              slot,
              beaconBlockRoot
            );

            const delaySec = chain.clock.secFromSlot(slot, seenTimestampSec);
            metrics?.gossipPayloadAttestationMessage.elapsedTimeTillReceived.observe({source: OpSource.api}, delaySec);

            const insertOutcome = chain.validationEngine.importPayloadAttestationMessage(
              payloadAttestationMessage,
              validationResult,
              {addToPool: true, addToForkChoice: true}
            );
            if (insertOutcome !== null) {
              metrics?.opPool.payloadAttestationPool.apiInsertOutcome.inc({insertOutcome});
            }

            chain.emitter.emit(routes.events.EventType.payloadAttestationMessage, {
              version: chain.config.getForkName(slot),
              data: payloadAttestationMessage,
            });

            await network.publishPayloadAttestationMessage(payloadAttestationMessage);
          } catch (e) {
            const logCtx = {
              slot: payloadAttestationMessage.data.slot,
              validatorIndex: payloadAttestationMessage.validatorIndex,
              beaconBlockRoot: toRootHex(payloadAttestationMessage.data.beaconBlockRoot),
            };

            if (
              e instanceof PayloadAttestationError &&
              e.type.code === PayloadAttestationErrorCode.PAYLOAD_ATTESTATION_ALREADY_KNOWN
            ) {
              logger.debug("Ignoring known payload attestation message", logCtx);
              return;
            }

            failures.push({index: i, message: (e as Error).message});
            logger.verbose(`Error on submitPayloadAttestationMessages [${i}]`, logCtx, e as Error);
            if (e instanceof PayloadAttestationError && e.action === GossipAction.REJECT) {
              chain.persistInvalidSszValue(
                ssz.gloas.PayloadAttestationMessage,
                payloadAttestationMessage,
                "api_reject"
              );
            }
          }
        })
      );

      if (failures.length > 0) {
        throw new IndexedError("Error processing payload attestation messages", failures);
      }
    },

    /**
     * POST `/eth/v1/beacon/pool/sync_committees`
     *
     * Submits sync committee signature objects to the node.
     * Sync committee signatures are not present in phase0, but are required for Altair networks.
     * If a sync committee signature is validated successfully the node MUST publish that sync committee signature on all applicable subnets.
     * If one or more sync committee signatures fail validation the node MUST return a 400 error with details of which sync committee signatures have failed, and why.
     *
     * https://github.com/ethereum/beacon-APIs/pull/135
     */
    async submitPoolSyncCommitteeSignatures({signatures}) {
      // Fetch states for all slots of the `signatures`
      const slots = new Set<Epoch>();
      for (const signature of signatures) {
        slots.add(signature.slot);
      }

      // TODO: Fetch states at signature slots
      const state = chain.getHeadState();
      if (!isStatePostAltair(state)) {
        throw new ApiError(400, "Sync committee pool is not supported before Altair");
      }

      const failures: FailureList = [];

      await Promise.all(
        signatures.map(async (signature, i) => {
          try {
            const validationResult = await chain.validationEngine.validateApiSyncCommitteeMessage(signature);

            // same to api attestation, we allow api SyncCommittee to be added to pool even when it's late
            // see https://github.com/ChainSafe/lodestar/issues/7548
            chain.validationEngine.importSyncCommitteeMessage(signature, validationResult, {priority: true});

            // The same validator can appear multiple times in the sync committee. It can appear multiple times per
            // subnet even. Positions are sorted by subnet, so adjacent de-duplication is enough.
            const subnets: number[] = [];
            for (const {subnet} of validationResult.positions) {
              if (subnets.length === 0 || subnets.at(-1) !== subnet) {
                subnets.push(subnet);
              }
            }

            // TODO: Broadcast at once to all topics
            await Promise.all(subnets.map(async (subnet) => network.publishSyncCommitteeSignature(signature, subnet)));
          } catch (e) {
            // TODO: gossipsub should allow publishing same message to different topics
            // https://github.com/ChainSafe/js-libp2p-gossipsub/issues/272
            if ((e as Error).message === "PublishError.Duplicate") {
              return;
            }

            failures.push({index: i, message: (e as Error).message});
            logger.verbose(
              `Error on submitPoolSyncCommitteeSignatures [${i}]`,
              {slot: signature.slot, validatorIndex: signature.validatorIndex},
              e as Error
            );
            if (e instanceof SyncCommitteeError && e.action === GossipAction.REJECT) {
              chain.persistInvalidSszValue(ssz.altair.SyncCommitteeMessage, signature, "api_reject");
            }
          }
        })
      );

      if (failures.length > 0) {
        throw new IndexedError("Error processing sync committee signatures", failures);
      }
    },
  };
}
