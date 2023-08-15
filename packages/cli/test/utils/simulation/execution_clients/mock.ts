import {SHARED_JWT_SECRET} from "../constants.js";
import {ExecutionClient, ExecutionNodeGenerator} from "../interfaces.js";
import {getNodePorts} from "../utils/ports.js";

export const generateMockNode: ExecutionNodeGenerator<ExecutionClient.Mock> = (opts, runner) => {
  const {id, ttd, nodeIndex} = opts;
  const {
    el: {enginePort, httpPort},
  } = getNodePorts(nodeIndex);
  const ethRpcUrl = `http://127.0.0.1:${httpPort}`;
  const engineRpcUrl = `http://127.0.0.1:${enginePort}`;

  const job = runner.create([]);

  return {
    client: ExecutionClient.Mock,
    id,
    engineRpcUrl,
    ethRpcUrl,
    ttd,
    jwtSecretHex: SHARED_JWT_SECRET,
    provider: null,
    job,
  };
};
