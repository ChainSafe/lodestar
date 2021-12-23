import tmp from "tmp";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import {SlashingProtection, Validator, Signers, SignerType} from "@chainsafe/lodestar-validator";
import {BeaconNode} from "../../../src/node";
import {testLogger, TestLoggerOpts} from "../logger";
import {SecretKey} from "@chainsafe/bls";
import {createServer} from "@chainsafe/lodestar-validator/test/unit/remoteSigner/utils";
import {remoteUrl} from "@chainsafe/lodestar-validator/test/unit/remoteSigner/constants";

export async function getAndInitDevValidators({
  node,
  validatorsPerClient = 8,
  validatorClientCount = 1,
  startIndex = 0,
  useRestApi,
  testLoggerOpts,
  signingMode,
}: {
  node: BeaconNode;
  validatorsPerClient: number;
  validatorClientCount: number;
  startIndex: number;
  useRestApi?: boolean;
  testLoggerOpts?: TestLoggerOpts;
  signingMode: string;
}): Promise<Validator[]> {
  const vcs: Promise<Validator>[] = [];
  if (signingMode === "remote") await createServer(validatorsPerClient);
  for (let i = 0; i < validatorClientCount; i++) {
    const startIndexVc = startIndex + i * validatorClientCount;
    const endIndex = startIndexVc + validatorsPerClient - 1;
    const logger = testLogger(`Vali ${startIndexVc}-${endIndex}`, testLoggerOpts);
    const tmpDir = tmp.dirSync({unsafeCleanup: true});
    const dbOps = {
      config: node.config,
      controller: new LevelDbController({name: tmpDir.name}, {logger}),
    };
    const slashingProtection = new SlashingProtection(dbOps);
    const secretKeys = Array.from({length: validatorsPerClient}, (_, i) => interopSecretKey(i + startIndexVc));
    let signers: Signers;
    if (signingMode === "local") {
      signers = {
        type: SignerType.Local,
        secretKeys: secretKeys,
      };
    } else {
      signers = {
        type: SignerType.Remote,
        url: remoteUrl,
        pubkeys: secretKeys.map((sk) => sk.toPublicKey()),
        secretKey: new SecretKey(),
      };
    }
    vcs.push(
      Validator.initializeFromBeaconNode({
        dbOps,
        api: useRestApi ? getNodeApiUrl(node) : node.api,
        slashingProtection,
        logger,
        signers,
      })
    );
  }

  return await Promise.all(vcs);
}

function getNodeApiUrl(node: BeaconNode): string {
  const host = node.opts.api.rest.host || "127.0.0.1";
  const port = node.opts.api.rest.port || 9596;
  return `http://${host}:${port}`;
}
