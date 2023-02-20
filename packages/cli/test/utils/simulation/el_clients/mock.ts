import {ELClient, ELClientGenerator} from "../interfaces.js";

export const generateMockNode: ELClientGenerator<ELClient.Mock> = (opts, runner) => {
  const {id, ethPort, enginePort, ttd, jwtSecretHex} = opts;
  const ethRpcUrl = `http://127.0.0.1:${ethPort}`;
  const engineRpcUrl = `http://127.0.0.1:${enginePort}`;

  const job = runner.create([]);

  return {
    client: ELClient.Mock,
    id,
    engineRpcUrl,
    ethRpcUrl,
    ttd,
    jwtSecretHex,
    provider: null,
    job,
  };
};
