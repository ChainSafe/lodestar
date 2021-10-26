// eslint-disable-next-line no-restricted-imports
import {Api as IBeaconPoolApi} from "@chainsafe/lodestar-api/lib/routes/beacon/pool";
import {Epoch, ssz} from "@chainsafe/lodestar-types";
import {allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {validateGossipAttestation} from "../../../../chain/validation";
import {validateGossipAttesterSlashing} from "../../../../chain/validation/attesterSlashing";
import {validateGossipProposerSlashing} from "../../../../chain/validation/proposerSlashing";
import {validateGossipVoluntaryExit} from "../../../../chain/validation/voluntaryExit";
import {validateSyncCommitteeSigOnly} from "../../../../chain/validation/syncCommittee";
import {ApiModules} from "../../types";
import {OpSource} from "../../../../metrics/validatorMonitor";
import {toHexString} from "@chainsafe/ssz";
import {AttestationError, AttestationErrorCode, GossipAction, SyncCommitteeError} from "../../../../chain/errors";
import {RegenCaller} from "../../../../chain/regen";

export function getBeaconPoolApi({
  chain,
  logger,
  metrics,
  network,
}: Pick<ApiModules, "chain" | "logger" | "metrics" | "network">): IBeaconPoolApi {
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

    /**
     * Do batch verification first:
     *   + Regen target state once
     *   + Do all validations without signature verification
     *   + Verify all signatures once
     * If it's failed to validate one of attestations, do one by one
     */
    async submitPoolAttestations(attestations) {
      const seenTimestampSec = Date.now() / 1000;
      const errors: Error[] = [];
      // validate in batch first to improve performance
      if (attestations.length === 0) {
        return;
      }
      // we want all attestations to have same target so that we can validate in batch
      const attTarget = attestations[0].data.target;
      for (let i = 1; i < attestations.length; i++) {
        if (!ssz.phase0.Checkpoint.equals(attestations[i].data.target, attTarget)) {
          throw Error("Target checkpoints are not unique");
        }
      }
      try {
        const targetState = await chain.regen.getCheckpointState(attTarget, RegenCaller.validateGossipAttestation);
        const attestationsBySubnet = new Map<number, phase0.Attestation[]>();
        const indexedAttestations: phase0.IndexedAttestation[] = [];
        await Promise.all(
          attestations.map(async (attestation) => {
            const {indexedAttestation, subnet} = await validateGossipAttestation(
              chain,
              attestation,
              null,
              targetState,
              true
            );
            indexedAttestations.push(indexedAttestation);
            let attestationsGroup = attestationsBySubnet.get(subnet);
            if (!attestationsGroup) {
              attestationsGroup = [];
              attestationsBySubnet.set(subnet, attestationsGroup);
            }
            attestationsGroup.push(attestation);
          })
        );
        const signatureSets = indexedAttestations.map((indexedAttestation) =>
          allForks.getIndexedAttestationSignatureSet(targetState, indexedAttestation)
        );
        if (!(await chain.bls.verifySignatureSets(signatureSets, {batchable: true}))) {
          throw new AttestationError(GossipAction.REJECT, {code: AttestationErrorCode.INVALID_SIGNATURE});
        }
        // all are validated
        for (const indexedAttestation of indexedAttestations) {
          metrics?.registerUnaggregatedAttestation(OpSource.api, seenTimestampSec, indexedAttestation);
          chain.seenAttesters.add(attTarget.epoch, indexedAttestation.attestingIndices[0]);
        }
        for (const [subnet, attestations] of attestationsBySubnet.entries()) {
          await Promise.all(attestations.map((a) => network.gossip.publishBeaconAttestation(a, subnet)));
          for (const attestation of attestations) {
            chain.attestationPool.add(attestation);
          }
        }
      } catch (e) {
        // failed to validate one of attestations
        // this is slow due to we validate signatures separately and state regen queue
        await Promise.all(
          attestations.map(async (attestation, i) => {
            try {
              const {indexedAttestation, subnet} = await validateGossipAttestation(chain, attestation, null);

              metrics?.registerUnaggregatedAttestation(OpSource.api, seenTimestampSec, indexedAttestation);

              await Promise.all([
                network.gossip.publishBeaconAttestation(attestation, subnet),
                chain.attestationPool.add(attestation),
              ]);
            } catch (e) {
              errors.push(e as Error);
              logger.error(
                `Error on submitPoolAttestations [${i}]`,
                {slot: attestation.data.slot, index: attestation.data.index},
                e as Error
              );
              if (e instanceof AttestationError && e.action === GossipAction.REJECT) {
                const archivedPath = chain.persistInvalidSszObject(
                  "attestation",
                  ssz.phase0.Attestation.serialize(attestation),
                  toHexString(ssz.phase0.Attestation.hashTreeRoot(attestation))
                );
                logger.debug("Submitted invalid attestation was written to", archivedPath);
              }
            }
          })
        );
      }

      if (errors.length > 1) {
        throw Error("Multiple errors on submitPoolAttestations\n" + errors.map((e) => e.message).join("\n"));
      } else if (errors.length === 1) {
        throw errors[0];
      }
    },

    async submitPoolAttesterSlashing(attesterSlashing) {
      await validateGossipAttesterSlashing(chain, attesterSlashing);
      chain.opPool.insertAttesterSlashing(attesterSlashing);
      await network.gossip.publishAttesterSlashing(attesterSlashing);
    },

    async submitPoolProposerSlashing(proposerSlashing) {
      await validateGossipProposerSlashing(chain, proposerSlashing);
      chain.opPool.insertProposerSlashing(proposerSlashing);
      await network.gossip.publishProposerSlashing(proposerSlashing);
    },

    async submitPoolVoluntaryExit(voluntaryExit) {
      await validateGossipVoluntaryExit(chain, voluntaryExit);
      chain.opPool.insertVoluntaryExit(voluntaryExit);
      await network.gossip.publishVoluntaryExit(voluntaryExit);
    },

    /**
     * POST `/eth/v1/beacon/pool/sync_committees`
     *
     * Submits sync committee signature objects to the node.
     * Sync committee signatures are not present in phase0, but are required for Altair networks.
     * If a sync committee signature is validated successfully the node MUST publish that sync committee signature on all applicable subnets.
     * If one or more sync committee signatures fail validation the node MUST return a 400 error with details of which sync committee signatures have failed, and why.
     *
     * https://github.com/ethereum/eth2.0-APIs/pull/135
     */
    async submitPoolSyncCommitteeSignatures(signatures) {
      // Fetch states for all slots of the `signatures`
      const slots = new Set<Epoch>();
      for (const signature of signatures) {
        slots.add(signature.slot);
      }

      // TODO: Fetch states at signature slots
      const state = chain.getHeadState();

      // TODO: Cache this value
      const SYNC_COMMITTEE_SUBNET_SIZE = Math.floor(SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);

      const errors: Error[] = [];

      await Promise.all(
        signatures.map(async (signature, i) => {
          try {
            const synCommittee = allForks.getIndexedSyncCommittee(state, signature.slot);
            const indexesInCommittee = synCommittee.validatorIndexMap.get(signature.validatorIndex);
            if (indexesInCommittee === undefined || indexesInCommittee.length === 0) {
              return; // Not a sync committee member
            }

            // Verify signature only, all other data is very likely to be correct, since the `signature` object is created by this node.
            // Worst case if `signature` is not valid, gossip peers will drop it and slightly downscore us.
            await validateSyncCommitteeSigOnly(chain, state, signature);

            await Promise.all(
              indexesInCommittee.map(async (indexInCommittee) => {
                // Sync committee subnet members are just sequential in the order they appear in SyncCommitteeIndexes array
                const subnet = Math.floor(indexInCommittee / SYNC_COMMITTEE_SUBNET_SIZE);
                const indexInSubCommittee = indexInCommittee % SYNC_COMMITTEE_SUBNET_SIZE;
                chain.syncCommitteeMessagePool.add(subnet, signature, indexInSubCommittee);
                await network.gossip.publishSyncCommitteeSignature(signature, subnet);
              })
            );
          } catch (e) {
            errors.push(e as Error);
            logger.error(
              `Error on submitPoolSyncCommitteeSignatures [${i}]`,
              {slot: signature.slot, validatorIndex: signature.validatorIndex},
              e as Error
            );
            if (e instanceof SyncCommitteeError && e.action === GossipAction.REJECT) {
              const archivedPath = chain.persistInvalidSszObject(
                "syncCommittee",
                ssz.altair.SyncCommitteeMessage.serialize(signature),
                toHexString(ssz.altair.SyncCommitteeMessage.hashTreeRoot(signature))
              );
              logger.debug("The submitted sync committee message was written to", archivedPath);
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
