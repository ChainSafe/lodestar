import {SHARED_JWT_SECRET} from "../constants.js";
import {ExecutionClient, ExecutionNodeGenerator} from "../interfaces.js";
import {getNodePorts} from "../utils/ports.js";

export const generateMockNode: ExecutionNodeGenerator<ExecutionClient.Mock> = (opts, runner) => {
  const {id, ttd, nodeIndex} = opts;
  const ports = getNodePorts(nodeIndex);
  const engineRpPublicUrl = `http://127.0.0.1:${ports.execution.enginePort}`;
  const engineRpPrivateUrl = engineRpPublicUrl;
  const ethRpPublicUrl = `http://127.0.0.1:${ports.execution.httpPort}`;
  const ethRpPrivateUrl = ethRpPublicUrl;

  const job = runner.create([]);

  return {
    client: ExecutionClient.Mock,
    id,
    engineRpPublicUrl,
    engineRpPrivateUrl,
    ethRpPublicUrl,
    ethRpPrivateUrl,
    ttd,
    jwtSecretHex: SHARED_JWT_SECRET,
    provider: null,
    job,
  };
};
