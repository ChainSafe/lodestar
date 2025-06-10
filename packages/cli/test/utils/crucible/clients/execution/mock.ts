import {ExecutionClient, ExecutionNodeGenerator} from "../../interfaces.js";
import {getNodePorts} from "../../utils/ports.js";

export const generateMockNode: ExecutionNodeGenerator<ExecutionClient.Mock> = (opts, runner) => {
  const {id, nodeIndex} = opts;

  const ports = getNodePorts(nodeIndex);
  const engineRpcPublicUrl = `http://127.0.0.1:${ports.execution.enginePort}`;
  const engineRpcPrivateUrl = engineRpcPublicUrl;
  const ethRpcPublicUrl = `http://127.0.0.1:${ports.execution.httpPort}`;
  const ethRpcPrivateUrl = ethRpcPublicUrl;

  const job = runner.create([]);

  return {
    client: ExecutionClient.Mock,
    id,
    engineRpcPublicUrl,
    engineRpcPrivateUrl,
    ethRpcPublicUrl,
    ethRpcPrivateUrl,
    provider: null,
    job,
  };
};
