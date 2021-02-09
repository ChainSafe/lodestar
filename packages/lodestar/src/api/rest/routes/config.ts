import {FastifyInstance} from "fastify";
import {getForkSchedule} from "../controllers/config";
import {getDepositContract} from "../controllers/config/getDepositContract";

export function registerConfigRoutes(server: FastifyInstance): void {
  server.register(
    async function (fastify) {
      fastify.get(getForkSchedule.url, getForkSchedule.opts, getForkSchedule.handler);
      fastify.get(getDepositContract.url, getDepositContract.opts, getDepositContract.handler);
    },
    {prefix: "v1/config"}
  );
}
