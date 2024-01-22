import {routes, ServerApi} from "@lodestar/api";
import {Epoch, ssz} from "@lodestar/types";
import {SYNC_COMMITTEE_SUBNET_SIZE} from "@lodestar/params";
import {validateApiAttestation} from "../../../../chain/validation/index.js";
import {validateApiAttesterSlashing} from "../../../../chain/validation/attesterSlashing.js";
import {validateApiProposerSlashing} from "../../../../chain/validation/proposerSlashing.js";
import {validateApiVoluntaryExit} from "../../../../chain/validation/voluntaryExit.js";
import {validateApiBlsToExecutionChange} from "../../../../chain/validation/blsToExecutionChange.js";
import {validateApiSyncCommittee} from "../../../../chain/validation/syncCommittee.js";
import {ApiModules} from "../../types.js";
import {
  AttestationError,
  AttestationErrorCode,
  GossipAction,
  SyncCommitteeError,
} from "../../../../chain/errors/index.js";
import {validateGossipFnRetryUnknownRoot} from "../../../../network/processor/gossipHandlers.js";

export function getBeaconPoolApi({
  chain,
  logger,
  metrics,
  network,
}: Pick<ApiModules, "chain" | "logger" | "metrics" | "network">): ServerApi<routes.beacon.pool.Api> {
  return {
    async getPoolAttestations(filters) {
      // Already filtered by slot
      let attestations = chain.aggregatedAttestationPool.getAll(filters?.slot);

      if (filters?.committeeIndex !== undefined) {
        attestations = attestations.filter((attestation) => filters.committeeIndex === attestation.data.index);
      }

      return {data: attestations};
    },

    async getPoolAttesterSlashings() {
      return {data: chain.opPool.getAllAttesterSlashings()};
    },

    async getPoolProposerSlashings() {
      return {data: chain.opPool.getAllProposerSlashings()};
    },

    async getPoolVoluntaryExits() {
      return {data: chain.opPool.getAllVoluntaryExits()};
    },

    async getPoolBlsToExecutionChanges() {
      return {data: chain.opPool.getAllBlsToExecutionChanges().map(({data}) => data)};
    },

    async submitPoolAttestations(attestations) {
      const seenTimestampSec = Date.now() / 1000;
      const errors: Error[] = [];

      await Promise.all(
        attestations.map(async (attestation, i) => {
          try {
            const fork = chain.config.getForkName(chain.clock.currentSlot);
            // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
            const validateFn = () => validateApiAttestation(fork, chain, {attestation, serializedData: null});
            const {slot, beaconBlockRoot} = attestation.data;
            // when a validator is configured with multiple beacon node urls, this attestation data may come from another beacon node
            // and the block hasn't been in our forkchoice since we haven't seen / processing that block
            // see https://github.com/ChainSafe/lodestar/issues/5098
            const {indexedAttestation, subnet, attDataRootHex} = await validateGossipFnRetryUnknownRoot(
              validateFn,
              network,
              chain,
              slot,
              beaconBlockRoot
            );

            if (network.shouldAggregate(subnet, slot)) {
              const insertOutcome = chain.attestationPool.add(attestation, attDataRootHex);
              metrics?.opPool.attestationPoolInsertOutcome.inc({insertOutcome});
            }

            chain.emitter.emit(routes.events.EventType.attestation, attestation);

            const sentPeers = await network.publishBeaconAttestation(attestation, subnet);
            metrics?.onPoolSubmitUnaggregatedAttestation(seenTimestampSec, indexedAttestation, subnet, sentPeers);
          } catch (e) {
            const logCtx = {slot: attestation.data.slot, index: attestation.data.index};

            if (e instanceof AttestationError && e.type.code === AttestationErrorCode.ATTESTATION_ALREADY_KNOWN) {
              logger.debug("Ignoring known attestation", logCtx);
              // Attestations might already be published by another node as part of a fallback setup or DVT cluster
              // and can reach our node by gossip before the api. The error can be ignored and should not result in a 500 response.
              return;
            }

            errors.push(e as Error);
            logger.error(`Error on submitPoolAttestations [${i}]`, logCtx, e as Error);
            if (e instanceof AttestationError && e.action === GossipAction.REJECT) {
              chain.persistInvalidSszValue(ssz.phase0.Attestation, attestation, "api_reject");
            }
          }
        })
      );

      if (errors.length > 1) {
        throw Error("Multiple errors on submitPoolAttestations\n" + errors.map((e) => e.message).join("\n"));
      } else if (errors.length === 1) {
        throw errors[0];
      }
    },

    async submitPoolAttesterSlashings(attesterSlashing) {
      await validateApiAttesterSlashing(chain, attesterSlashing);
      chain.opPool.insertAttesterSlashing(attesterSlashing);
      await network.publishAttesterSlashing(attesterSlashing);
    },

    async submitPoolProposerSlashings(proposerSlashing) {
      await validateApiProposerSlashing(chain, proposerSlashing);
      chain.opPool.insertProposerSlashing(proposerSlashing);
      await network.publishProposerSlashing(proposerSlashing);
    },

    async submitPoolVoluntaryExit(voluntaryExit) {
      await validateApiVoluntaryExit(chain, voluntaryExit);
      chain.opPool.insertVoluntaryExit(voluntaryExit);
      chain.emitter.emit(routes.events.EventType.voluntaryExit, voluntaryExit);
      await network.publishVoluntaryExit(voluntaryExit);
    },

    async submitPoolBlsToExecutionChange(blsToExecutionChanges) {
      const errors: Error[] = [];

      await Promise.all(
        blsToExecutionChanges.map(async (blsToExecutionChange, i) => {
          try {
            // Ignore even if the change exists and reprocess
            await validateApiBlsToExecutionChange(chain, blsToExecutionChange);
            const preCapella = chain.clock.currentEpoch < chain.config.CAPELLA_FORK_EPOCH;
            chain.opPool.insertBlsToExecutionChange(blsToExecutionChange, preCapella);

            chain.emitter.emit(routes.events.EventType.blsToExecutionChange, blsToExecutionChange);

            if (!preCapella) {
              await network.publishBlsToExecutionChange(blsToExecutionChange);
            }
          } catch (e) {
            errors.push(e as Error);
            logger.error(
              `Error on submitPoolBlsToExecutionChange [${i}]`,
              {validatorIndex: blsToExecutionChange.message.validatorIndex},
              e as Error
            );
          }
        })
      );

      if (errors.length > 1) {
        throw Error("Multiple errors on submitPoolBlsToExecutionChange\n" + errors.map((e) => e.message).join("\n"));
      } else if (errors.length === 1) {
        throw errors[0];
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
    async submitPoolSyncCommitteeSignatures(signatures) {
      // Fetch states for all slots of the `signatures`
      const slots = new Set<Epoch>();
      for (const signature of signatures) {
        slots.add(signature.slot);
      }

      // TODO: Fetch states at signature slots
      const state = chain.getHeadState();

      const errors: Error[] = [];

      await Promise.all(
        signatures.map(async (signature, i) => {
          try {
            const synCommittee = state.epochCtx.getIndexedSyncCommittee(signature.slot);
            const indexesInCommittee = synCommittee.validatorIndexMap.get(signature.validatorIndex);
            if (indexesInCommittee === undefined || indexesInCommittee.length === 0) {
              return; // Not a sync committee member
            }

            // Verify signature only, all other data is very likely to be correct, since the `signature` object is created by this node.
            // Worst case if `signature` is not valid, gossip peers will drop it and slightly downscore us.
            await validateApiSyncCommittee(chain, state, signature);

            // The same validator can appear multiple times in the sync committee. It can appear multiple times per
            // subnet even. First compute on which subnet the signature must be broadcasted to.
            const subnets: number[] = [];

            for (const indexInCommittee of indexesInCommittee) {
              // Sync committee subnet members are just sequential in the order they appear in SyncCommitteeIndexes array
              const subnet = Math.floor(indexInCommittee / SYNC_COMMITTEE_SUBNET_SIZE);
              const indexInSubcommittee = indexInCommittee % SYNC_COMMITTEE_SUBNET_SIZE;
              chain.syncCommitteeMessagePool.add(subnet, signature, indexInSubcommittee);

              // Cheap de-duplication code to avoid using a Set. indexesInCommittee is always sorted
              if (subnets.length === 0 || subnets[subnets.length - 1] !== subnet) {
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

            errors.push(e as Error);
            logger.debug(
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

      if (errors.length > 1) {
        throw Error("Multiple errors on submitPoolSyncCommitteeSignatures\n" + errors.map((e) => e.message).join("\n"));
      } else if (errors.length === 1) {
        throw errors[0];
      }
    },
  };
}
