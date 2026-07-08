import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {ForkName, ForkPostElectra, ForkPreElectra, isForkPostElectra, isForkPostGloas} from "@lodestar/params";
import {SingleAttestation, isElectraAttestation, ssz, sszTypesFor} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {GossipValidationStatus} from "../../../../chain/beaconEngine/gossipValidationResult.js";
import {
  AttestationErrorCode,
  PayloadAttestationErrorCode,
  ProposerPreferencesErrorCode,
} from "../../../../chain/errors/index.js";
import {toElectraSingleAttestation} from "../../../../chain/validation/index.js";
import {validateGossipFnRetryUnknownRoot} from "../../../../network/processor/gossipHandlers.js";
import {getFixedListElementBytes} from "../../../../util/sszBytes.js";
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
      let attestations = chain.beaconEngine.getPoolAggregatedAttestations(slot);
      const fork = chain.config.getForkName(slot ?? attestations[0]?.data.slot ?? chain.clock.currentSlot);
      const isPostElectra = isForkPostElectra(fork);

      attestations = attestations.filter((attestation) =>
        isPostElectra ? isElectraAttestation(attestation) : !isElectraAttestation(attestation)
      );

      if (committeeIndex !== undefined) {
        attestations = attestations.filter((attestation) => committeeIndex === attestation.data.index);
      }

      return {data: attestations, meta: {version: fork}};
    },

    async getPoolPayloadAttestations({slot}) {
      const fork = chain.config.getForkName(slot ?? chain.clock.currentSlot);
      if (!isForkPostGloas(fork)) {
        throw new ApiError(400, `Payload attestation pool is not supported before Gloas fork=${fork}`);
      }

      return {data: chain.beaconEngine.getPoolPayloadAttestations(slot), meta: {version: fork}};
    },

    async getPoolProposerPreferences({slot}) {
      const fork = chain.config.getForkName(slot ?? chain.clock.currentSlot);
      if (!isForkPostGloas(fork)) {
        throw new ApiError(400, `Proposer preferences pool is not supported before Gloas fork=${fork}`);
      }

      return {data: chain.beaconEngine.getPoolProposerPreferences(slot), meta: {version: fork}};
    },

    async submitSignedProposerPreferences({signedProposerPreferences}, context) {
      const failures: FailureList = [];

      // SSZ request: slice each entry out of the (fixed-size element) list body. JSON request
      // (no sszBytes): serialize once.
      const preferencesBytes = context?.sszBytes
        ? getFixedListElementBytes(context.sszBytes, ssz.gloas.SignedProposerPreferences.fixedSize)
        : signedProposerPreferences.map((s) => ssz.gloas.SignedProposerPreferences.serialize(s));

      await Promise.all(
        signedProposerPreferences.map(async (signed, i) => {
          const logCtx = {
            slot: signed.message.proposalSlot,
            validatorIndex: signed.message.validatorIndex,
            dependentRoot: toRootHex(signed.message.dependentRoot),
          };
          try {
            const res = await chain.beaconEngine.validateGossipProposerPreferences(preferencesBytes[i], signed);
            if (res.status !== GossipValidationStatus.Accept) {
              if (res.code === ProposerPreferencesErrorCode.ALREADY_KNOWN) {
                logger.debug("Ignoring known signed proposer preferences", logCtx);
                return;
              }
              failures.push({index: i, message: res.error?.message ?? res.code});
              logger.verbose(`Error on submitSignedProposerPreferences [${i}]`, logCtx, res.error);
              if (res.status === GossipValidationStatus.Reject) {
                chain.persistInvalidSszValue(ssz.gloas.SignedProposerPreferences, signed, "api_reject");
              }
              return;
            }

            // Engine inserted into its (internal) proposerPreferencesPool on Accept above.
            await network.publishProposerPreferences(signed);
            chain.emitter.emit(routes.events.EventType.proposerPreferences, {
              version: ForkName.gloas,
              data: signed,
            });
          } catch (e) {
            failures.push({index: i, message: (e as Error).message});
            logger.verbose(`Error on submitSignedProposerPreferences [${i}]`, logCtx, e as Error);
          }
        })
      );

      if (failures.length > 0) {
        throw new IndexedError("Error processing signed proposer preferences", failures);
      }
    },

    async getPoolAttesterSlashingsV2() {
      const fork = chain.config.getForkName(chain.clock.currentSlot);
      return {data: chain.beaconEngine.getPoolAttesterSlashings(), meta: {version: fork}};
    },

    async getPoolProposerSlashings() {
      return {data: chain.beaconEngine.getPoolProposerSlashings()};
    },

    async getPoolVoluntaryExits() {
      return {data: chain.beaconEngine.getPoolVoluntaryExits()};
    },

    async getPoolBLSToExecutionChanges() {
      return {data: chain.beaconEngine.getPoolBlsToExecutionChanges()};
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
          const logCtx = {slot: attestation.data.slot, index: attestation.data.index};
          try {
            const validateFn = () =>
              chain.beaconEngine.validateApiAttestation(fork, {attestation, serializedData: null});
            const {slot, beaconBlockRoot} = attestation.data;
            // when a validator is configured with multiple beacon node urls, this attestation data may come from another beacon node
            // and the block hasn't been in our forkchoice since we haven't seen / processing that block
            // see https://github.com/ChainSafe/lodestar/issues/5098
            const res = await validateGossipFnRetryUnknownRoot(validateFn, network, chain, slot, beaconBlockRoot);
            if (res.status !== GossipValidationStatus.Accept) {
              if (res.code === AttestationErrorCode.ATTESTATION_ALREADY_KNOWN) {
                // Attestations might already be published by another node as part of a fallback setup or DVT cluster
                // and can reach our node by gossip before the api. Should not result in a 500 response.
                logger.debug("Ignoring known attestation", logCtx);
                return;
              }
              failures.push({index: i, message: res.error?.message ?? res.code});
              logger.verbose(`Error on submitPoolAttestations [${i}]`, logCtx, res.error);
              if (res.status === GossipValidationStatus.Reject) {
                chain.persistInvalidSszValue(sszTypesFor(fork).SingleAttestation, attestation, "api_reject");
              }
              return;
            }
            const {indexedAttestation, subnet, attDataRootHex, committeeIndex, validatorCommitteeIndex, committeeSize} =
              res.value;

            if (network.shouldAggregate(subnet, slot)) {
              const insertOutcome = chain.beaconEngine.addAttestationToPool(
                committeeIndex,
                attestation,
                attDataRootHex,
                validatorCommitteeIndex,
                committeeSize,
                priority
              );
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
            // Validation no longer throws (handled above); this catches post-validation failures (publish/pool add).
            failures.push({index: i, message: (e as Error).message});
            logger.verbose(`Error on submitPoolAttestations [${i}]`, logCtx, e as Error);
          }
        })
      );

      if (failures.length > 0) {
        throw new IndexedError("Error processing attestations", failures);
      }
    },

    async submitPoolAttesterSlashingsV2({attesterSlashing}) {
      const fork = chain.config.getForkName(Number(attesterSlashing.attestation1.data.slot));
      // Engine validates + inserts into its (internal) opPool; facade only publishes.
      await chain.beaconEngine.validateApiAttesterSlashing(attesterSlashing, fork);
      await network.publishAttesterSlashing(attesterSlashing);
    },

    async submitPoolProposerSlashings({proposerSlashing}) {
      await chain.beaconEngine.validateApiProposerSlashing(proposerSlashing);
      await network.publishProposerSlashing(proposerSlashing);
    },

    async submitPoolVoluntaryExit({signedVoluntaryExit}) {
      await chain.beaconEngine.validateApiVoluntaryExit(signedVoluntaryExit);
      chain.emitter.emit(routes.events.EventType.voluntaryExit, signedVoluntaryExit);
      await network.publishVoluntaryExit(signedVoluntaryExit);
    },

    async submitPoolBLSToExecutionChange({blsToExecutionChanges}) {
      const failures: FailureList = [];

      await Promise.all(
        blsToExecutionChanges.map(async (blsToExecutionChange, i) => {
          try {
            const preCapella = chain.clock.currentEpoch < chain.config.CAPELLA_FORK_EPOCH;
            // Ignore even if the change exists and reprocess; engine validates + inserts into its opPool.
            await chain.beaconEngine.validateApiBlsToExecutionChange(blsToExecutionChange, preCapella);

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

    async submitPayloadAttestationMessages({payloadAttestationMessages}, context) {
      const failures: FailureList = [];

      // SSZ request: slice each message out of the (fixed-size element) list body. JSON request
      // (no sszBytes): serialize once.
      const messageBytes = context?.sszBytes
        ? getFixedListElementBytes(context.sszBytes, ssz.gloas.PayloadAttestationMessage.fixedSize)
        : payloadAttestationMessages.map((m) => ssz.gloas.PayloadAttestationMessage.serialize(m));

      await Promise.all(
        payloadAttestationMessages.map(async (payloadAttestationMessage, i) => {
          const logCtx = {
            slot: payloadAttestationMessage.data.slot,
            validatorIndex: payloadAttestationMessage.validatorIndex,
            beaconBlockRoot: toRootHex(payloadAttestationMessage.data.beaconBlockRoot),
          };
          try {
            const validateFn = () =>
              chain.beaconEngine.validateApiPayloadAttestationMessage(messageBytes[i], payloadAttestationMessage);
            const {slot, beaconBlockRoot} = payloadAttestationMessage.data;
            const res = await validateGossipFnRetryUnknownRoot(validateFn, network, chain, slot, beaconBlockRoot);
            if (res.status !== GossipValidationStatus.Accept) {
              if (res.code === PayloadAttestationErrorCode.PAYLOAD_ATTESTATION_ALREADY_KNOWN) {
                logger.debug("Ignoring known payload attestation message", logCtx);
                return;
              }
              failures.push({index: i, message: res.error?.message ?? res.code});
              logger.verbose(`Error on submitPayloadAttestationMessages [${i}]`, logCtx, res.error);
              if (res.status === GossipValidationStatus.Reject) {
                chain.persistInvalidSszValue(
                  ssz.gloas.PayloadAttestationMessage,
                  payloadAttestationMessage,
                  "api_reject"
                );
              }
              return;
            }

            await network.publishPayloadAttestationMessage(payloadAttestationMessage);
          } catch (e) {
            failures.push({index: i, message: (e as Error).message});
            logger.verbose(`Error on submitPayloadAttestationMessages [${i}]`, logCtx, e as Error);
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
    async submitPoolSyncCommitteeSignatures({signatures}, context) {
      // SSZ request: slice each message out of the (fixed-size element) list body. JSON request
      // (no sszBytes): serialize once. Never re-serialize on the SSZ path.
      const signatureBytes = context?.sszBytes
        ? getFixedListElementBytes(context.sszBytes, ssz.altair.SyncCommitteeMessage.fixedSize)
        : signatures.map((s) => ssz.altair.SyncCommitteeMessage.serialize(s));

      const failures: FailureList = [];

      await Promise.all(
        signatures.map(async (signature, i) => {
          try {
            // Engine verifies the signature (allowing late API messages), resolves committee membership,
            // inserts into its (internal) pool, and returns the subnets to broadcast to (empty if this
            // validator isn't in the sync committee).
            const res = await chain.beaconEngine.validateApiSyncCommittee(signatureBytes[i], signature);
            if (res.status !== GossipValidationStatus.Accept) {
              failures.push({index: i, message: res.error?.message ?? res.code});
              logger.verbose(
                `Error on submitPoolSyncCommitteeSignatures [${i}]`,
                {slot: signature.slot, validatorIndex: signature.validatorIndex},
                res.error
              );
              if (res.status === GossipValidationStatus.Reject) {
                chain.persistInvalidSszValue(ssz.altair.SyncCommitteeMessage, signature, "api_reject");
              }
              return;
            }

            // TODO: Broadcast at once to all topics
            await Promise.all(
              res.value.subnets.map(async (subnet) => network.publishSyncCommitteeSignature(signature, subnet))
            );
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
          }
        })
      );

      if (failures.length > 0) {
        throw new IndexedError("Error processing sync committee signatures", failures);
      }
    },
  };
}
