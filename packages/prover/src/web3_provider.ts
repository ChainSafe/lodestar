import {LogLevel} from "@lodestar/logger";
import {getBrowserLogger} from "@lodestar/logger/browser";
import {Logger} from "@lodestar/utils";
import {AnyWeb3Provider, ELRequestHandler, VerifiedExecutionInitOptions} from "./interfaces.js";
import {ProofProvider} from "./proof_provider/proof_provider.js";
import {processAndVerifyRequest} from "./utils/process.js";
import {ELRpcProvider} from "./utils/rpc_provider.js";
import {Web3ProviderInspector} from "./web3_provider_inspector.js";

export type Web3ProviderTypeHandler<T extends AnyWeb3Provider> = (
  provider: T,
  proofProvider: ProofProvider,
  logger: Logger
) => {provider: T; handler: ELRpcProvider["handler"]};

export function createVerifiedExecutionProvider<
  T extends AnyWeb3Provider,
  Mutate extends undefined | boolean = true,
  Return = {provider: Mutate extends undefined | true ? T : ELRpcProvider; proofProvider: ProofProvider},
>(provider: T, opts: VerifiedExecutionInitOptions<Mutate>): Return {
  const signal = opts.signal ?? new AbortController().signal;
  const logger = opts.logger ?? getBrowserLogger({level: opts.logLevel ?? LogLevel.info});
  const mutateProvider = opts.mutateProvider === undefined;
  const customProviderTypes = opts.providerTypes ?? [];

  const providerInspector = Web3ProviderInspector.initWithDefault({logger});
  for (const providerType of customProviderTypes.reverse()) {
    providerInspector.register(providerType, {index: 0});
  }
  const providerType = providerInspector.detect(provider);
  logger.debug(`Provider is detected as '${providerType.name}' provider.`);

  const proofProvider = ProofProvider.init({
    ...opts,
    signal,
    logger,
  });

  const nonVerifiedHandler = providerType.handler(provider);
  const nonVerifiedRpc = new ELRpcProvider(nonVerifiedHandler, logger);

  nonVerifiedRpc.verifyCompatibility().catch((err) => {
    logger.error(err);
    logger.error("Due to compatibility issues, verified execution may not work properly.");
  });

  const verifiedHandler: ELRequestHandler = function newVerifiedHandler(payload) {
    return processAndVerifyRequest({payload, rpc: nonVerifiedRpc, logger, proofProvider});
  };

  if (mutateProvider) {
    providerType.mutateProvider(provider, verifiedHandler);
    return {provider, proofProvider} as Return;
  }

  // Verified RPC
  return {provider: new ELRpcProvider(verifiedHandler, logger), proofProvider} as Return;
}
