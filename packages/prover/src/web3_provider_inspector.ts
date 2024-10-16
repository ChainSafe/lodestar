import {Logger} from "@lodestar/logger";
import {AnyWeb3Provider, Web3ProviderType} from "./interfaces.js";

import web3jsProviderType from "./provider_types/web3_js_provider_type.js";
import ethersProviderType from "./provider_types/ethers_provider_type.js";
import eip1193ProviderType from "./provider_types/eip1193_provider_type.js";
import legacyProviderType from "./provider_types/legacy_provider_type.js";

export class Web3ProviderInspector {
  protected providerTypes: Web3ProviderType<AnyWeb3Provider>[] = [];
  logger: Logger;

  protected constructor(opts: {logger: Logger}) {
    this.logger = opts.logger;
  }

  static initWithDefault(opts: {logger: Logger}): Web3ProviderInspector {
    const inspector = new Web3ProviderInspector(opts);
    inspector.register(web3jsProviderType, {index: 0});
    inspector.register(ethersProviderType, {index: 1});
    inspector.register(eip1193ProviderType, {index: 2});
    inspector.register(legacyProviderType, {index: 3});

    return inspector;
  }

  getProviderTypes(): Web3ProviderType<AnyWeb3Provider>[] {
    // Destruct so user can not mutate the output
    return [...this.providerTypes];
  }

  register(providerType: Web3ProviderType<AnyWeb3Provider>, opts?: {index?: number}): void {
    // If user does not provider index, we will register the provider type to last
    let index = opts?.index ?? this.providerTypes.length;

    // If index is larger, let's add type at the end
    if (index > this.providerTypes.length) {
      index = this.providerTypes.length;
    }

    // If a lower index is provided let's add type at the start
    if (index < 0) {
      index = 0;
    }

    if (this.providerTypes.map((p) => p.name).includes(providerType.name)) {
      throw new Error(`Provider type '${providerType.name}' is already registered.`);
    }

    // If some provider type is already register on that index, we will make space for new
    if (this.providerTypes.at(index)) {
      this.logger.debug(
        `A provider type '${this.providerTypes[index].name}' already existed at index '${index}', now moved down.`
      );
      this.providerTypes.splice(index, 0, providerType);
    }

    this.logger.debug(`Registered provider type "${providerType.name}" at index ${index}`);
    this.providerTypes[index] = providerType;
  }

  unregister(indexOrName: string | number): void {
    if (typeof indexOrName === "number") {
      if (indexOrName > this.providerTypes.length || indexOrName < 0) {
        throw new Error(`Provider type at index '${indexOrName}' is not registered.`);
      }
      this.providerTypes.splice(indexOrName, 1);
      return;
    }

    const index = this.providerTypes.findIndex((p) => p.name === indexOrName);
    if (index < 0) {
      throw Error(`Provider type '${indexOrName}' is not registered.`);
    }
    this.providerTypes.splice(index, 1);
  }

  detect(provider: AnyWeb3Provider): Web3ProviderType<AnyWeb3Provider> {
    for (const providerType of Object.values(this.providerTypes)) {
      if (providerType.matched(provider)) {
        return providerType;
      }
    }

    throw new Error(
      `Given provider could not be detected of any type. Supported types are ${Object.keys(this.providerTypes).join()}`
    );
  }
}
