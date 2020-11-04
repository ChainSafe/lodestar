import {FastifyInstance} from "fastify";
import {
  getBlock,
  getBlockAttestations,
  getBlockHeader,
  getBlockHeaders,
  getBlockRoot,
  getGenesis,
  getPoolAttestations,
  getStateFinalityCheckpoints,
  getVoluntaryExits,
  publishBlock,
  submitVoluntaryExit,
  getStateFork,
} from "../../controllers/beacon";
import {getAttesterSlashings} from "../../controllers/beacon/pool/getAttesterSlashings";
import {getProposerSlashings} from "../../controllers/beacon/pool/getProposerSlashings";
import {submitAttesterSlashing} from "../../controllers/beacon/pool/submitAttesterSlashing";
import {submitPoolAttestation} from "../../controllers/beacon/pool/submitPoolAttestation";
import {submitProposerSlashing} from "../../controllers/beacon/pool/submitProposerSlashing";

//new
export function registerBeaconRoutes(server: FastifyInstance): void {
  server.register(
    async function (fastify) {
      fastify.get(getGenesis.url, getGenesis.opts, getGenesis.handler);

      //state
      fastify.get(
        getStateFinalityCheckpoints.url,
        getStateFinalityCheckpoints.opts,
        getStateFinalityCheckpoints.handler
      );
      fastify.get(getStateFork.url, getStateFork.opts, getStateFork.handler);

      //pool
      fastify.get(getPoolAttestations.url, getPoolAttestations.opts, getPoolAttestations.handler);
      fastify.post(submitPoolAttestation.url, submitPoolAttestation.opts, submitPoolAttestation.handler);
      fastify.get(getAttesterSlashings.url, getAttesterSlashings.opts, getAttesterSlashings.handler);
      fastify.post(submitAttesterSlashing.url, submitAttesterSlashing.opts, submitAttesterSlashing.handler);
      fastify.get(getProposerSlashings.url, getProposerSlashings.opts, getProposerSlashings.handler);
      fastify.post(submitProposerSlashing.url, submitProposerSlashing.opts, submitProposerSlashing.handler);
      fastify.get(getVoluntaryExits.url, getVoluntaryExits.opts, getVoluntaryExits.handler);
      fastify.post(submitVoluntaryExit.url, submitVoluntaryExit.opts, submitVoluntaryExit.handler);

      //blocks
      fastify.get(getBlockHeaders.url, getBlockHeaders.opts, getBlockHeaders.handler);
      fastify.get(getBlockHeader.url, getBlockHeader.opts, getBlockHeader.handler);
      fastify.get(getBlock.url, getBlock.opts, getBlock.handler);
      fastify.get(getBlockRoot.url, getBlockRoot.opts, getBlockRoot.handler);
      fastify.get(getBlockAttestations.url, getBlockAttestations.opts, getBlockAttestations.handler);
      fastify.post(publishBlock.url, publishBlock.opts, publishBlock.handler);
    },
    {prefix: "/v1/beacon"}
  );
}
