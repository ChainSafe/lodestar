import {ELClient, ELClientGenerator} from "../interfaces.js";

export const generateMockNode: ELClientGenerator<ELClient.Mock> = (
  {id, ethPort, enginePort, ttd, jwtSecretHex},
  runner
) => {
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
