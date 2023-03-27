import {routes, ServerApi} from "@lodestar/api";
import {Epoch, phase0, ssz} from "@lodestar/types";
import {SYNC_COMMITTEE_SUBNET_SIZE} from "@lodestar/params";
import {validateApiAttestations, validateGossipAttestation} from "../../../../chain/validation/index.js";
import {validateGossipAttesterSlashing} from "../../../../chain/validation/attesterSlashing.js";
import {validateGossipProposerSlashing} from "../../../../chain/validation/proposerSlashing.js";
import {validateGossipVoluntaryExit} from "../../../../chain/validation/voluntaryExit.js";
import {validateBlsToExecutionChange} from "../../../../chain/validation/blsToExecutionChange.js";
import {validateSyncCommitteeSigOnly} from "../../../../chain/validation/syncCommittee.js";
import {ApiModules} from "../../types.js";
import {AttestationError, GossipAction, SyncCommitteeError} from "../../../../chain/errors/index.js";
import {validateGossipFnRetryUnknownRoot} from "../../../../network/processor/gossipHandlers.js";
import {wrapError} from "../../../../util/wrapError.js";
import {byteArrayEquals} from "../../../../util/bytes.js";

export function getBeaconPoolApi({
  chain,
  logger,
  metrics,
  network,
}: Pick<ApiModules, "chain" | "logger" | "metrics" | "network">): ServerApi<routes.beacon.pool.Api> {
  const submitPoolAttestationsOneByOne = async (attestations: phase0.Attestation[]): Promise<void> => {
    const seenTimestampSec = Date.now() / 1000;
    const errors: Error[] = [];

    await Promise.all(
      attestations.map(async (attestation, i) => {
        try {
          // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
          const validateFn = () => validateGossipAttestation(chain, attestation, null);
          const {slot, beaconBlockRoot} = attestation.data;
          // when a validator is configured with multiple beacon node urls, this attestation data may come from another beacon node
          // and the block hasn't been in our forkchoice since we haven't seen / processing that block
          // see https://github.com/ChainSafe/lodestar/issues/5098
          const {indexedAttestation, subnet} = await validateGossipFnRetryUnknownRoot(
            validateFn,
            chain,
            slot,
            beaconBlockRoot
          );

          const sentPeers = await network.gossip.publishBeaconAttestation(attestation, subnet);
          metrics?.submitUnaggregatedAttestation(seenTimestampSec, indexedAttestation, subnet, sentPeers);
          if (network.attnetsService.shouldProcess(subnet, slot)) {
            const insertOutcome = chain.attestationPool.add(attestation);
            metrics?.opPool.attestationPoolInsertOutcome.inc({insertOutcome});
          }
        } catch (e) {
          errors.push(e as Error);
          logger.error(
            `Error on submitPoolAttestations [${i}]`,
            {slot: attestation.data.slot, index: attestation.data.index},
            e as Error
          );
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
  };

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
      const count = attestations.length;
      if (count <= 1 || !isSameData(attestations)) {
        logger.verbose("Api attestations don't have same attestation data or less than 2", {count});
        return submitPoolAttestationsOneByOne(attestations);
      }

      const {slot, beaconBlockRoot} = attestations[0].data;
      // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      const validateBatchFn = () => validateApiAttestations(chain, attestations);
      const batchResult = await wrapError(
        validateGossipFnRetryUnknownRoot(validateBatchFn, chain, slot, beaconBlockRoot)
      );

      if (batchResult.err) {
        // try our best to spread valid attestations
        logger.verbose("Api attestations failed batch validation, re-validate one by one", {count});
        return submitPoolAttestationsOneByOne(attestations);
      }

      // pass batch validation, handle in batch, same logic to submitPoolAttestationsOneByOne()
      const validationResults = batchResult.result;
      await Promise.all(
        attestations.map(async (attestation, i) => {
          const {indexedAttestation, subnet} = validationResults[i];
          const sentPeers = await network.gossip.publishBeaconAttestation(attestation, subnet);
          metrics?.submitUnaggregatedAttestation(seenTimestampSec, indexedAttestation, subnet, sentPeers);
          if (network.attnetsService.shouldProcess(subnet, attestation.data.slot)) {
            const insertOutcome = chain.attestationPool.add(attestation);
            metrics?.opPool.attestationPoolInsertOutcome.inc({insertOutcome});
          }
        })
      );
    },

    async submitPoolAttesterSlashings(attesterSlashing) {
      await validateGossipAttesterSlashing(chain, attesterSlashing);
      chain.opPool.insertAttesterSlashing(attesterSlashing);
      await network.gossip.publishAttesterSlashing(attesterSlashing);
    },

    async submitPoolProposerSlashings(proposerSlashing) {
      await validateGossipProposerSlashing(chain, proposerSlashing);
      chain.opPool.insertProposerSlashing(proposerSlashing);
      await network.gossip.publishProposerSlashing(proposerSlashing);
    },

    async submitPoolVoluntaryExit(voluntaryExit) {
      await validateGossipVoluntaryExit(chain, voluntaryExit);
      chain.opPool.insertVoluntaryExit(voluntaryExit);
      await network.gossip.publishVoluntaryExit(voluntaryExit);
    },

    async submitPoolBlsToExecutionChange(blsToExecutionChanges) {
      const errors: Error[] = [];

      await Promise.all(
        blsToExecutionChanges.map(async (blsToExecutionChange, i) => {
          try {
            // Ignore even if the change exists and reprocess
            await validateBlsToExecutionChange(chain, blsToExecutionChange, true);
            const preCapella = chain.clock.currentEpoch < chain.config.CAPELLA_FORK_EPOCH;
            chain.opPool.insertBlsToExecutionChange(blsToExecutionChange, preCapella);
            if (!preCapella) {
              await network.gossip.publishBlsToExecutionChange(blsToExecutionChange);
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
            await validateSyncCommitteeSigOnly(chain, state, signature);

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
            await Promise.all(
              subnets.map(async (subnet) => network.gossip.publishSyncCommitteeSignature(signature, subnet))
            );
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
        throw Error("Multiple errors on publishAggregateAndProofs\n" + errors.map((e) => e.message).join("\n"));
      } else if (errors.length === 1) {
        throw errors[0];
      }
    },
  };
}

function isSameData(attestations: phase0.Attestation[]): boolean {
  if (attestations.length <= 1) {
    return true;
  }
  const {slot: attSlot, beaconBlockRoot: attBlock, source: attSource, target: attTarget} = attestations[0].data;

  for (let i = 1; i < attestations.length; i++) {
    const {slot, beaconBlockRoot, source, target} = attestations[i].data;
    if (
      slot !== attSlot ||
      !byteArrayEquals(beaconBlockRoot, attBlock) ||
      !ssz.phase0.Checkpoint.equals(target, attTarget) ||
      !ssz.phase0.Checkpoint.equals(source, attSource)
    ) {
      return false;
    }
  }

  return true;
}
