import {IChainConfig, chainConfigToJson, defaultChainConfig} from "@chainsafe/lodestar-config";

export class NotEqualParamsError extends Error {}

/**
 * Assert localConfig values match externalSpecJson. externalSpecJson may contain more values than localConfig.
 */
export function assertEqualParams(localConfig: IChainConfig, externalSpecJson: Record<string, string>): void {
  const localConfigJson = chainConfigToJson(localConfig) as Record<string, unknown>;

  const externalSpecJsonWithDefaults = {
    // fill missing properties in remote config with spec default values
    ...chainConfigToJson(defaultChainConfig),
    ...externalSpecJson,
  };

  const errors: string[] = [];

  // Ensure only that the localConfig values match the remote spec
  for (const key of Object.keys(localConfigJson)) {
    const localValue = String(localConfigJson[key]).toLocaleLowerCase();
    const remoteValue = String(externalSpecJsonWithDefaults[key]).toLocaleLowerCase();
    if (localValue !== remoteValue) {
      errors.push(`${key} different value: ${localValue} != ${remoteValue}`);
    }
  }

  if (errors.length > 0) {
    throw new NotEqualParamsError("Not equal BeaconParams\n" + errors.join("\n"));
  }
}
