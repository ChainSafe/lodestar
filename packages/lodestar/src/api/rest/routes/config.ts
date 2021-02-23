import {FastifyInstance} from "fastify";
import {getForkSchedule} from "../controllers/config";
import {getDepositContract} from "../controllers/config/getDepositContract";
import {getSpec} from "../controllers/config/getSpec";

export function registerConfigRoutes(server: FastifyInstance): void {
  server.register(
    async function (fastify) {
      fastify.get(getForkSchedule.url, getForkSchedule.opts, getForkSchedule.handler);
      fastify.get(getDepositContract.url, getDepositContract.opts, getDepositContract.handler);
      fastify.get(getSpec.url, getSpec.opts, getSpec.handler);
    },
    {prefix: "v1/config"}
  );
}
