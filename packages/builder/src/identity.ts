import {ApiClient} from "@lodestar/api";
import {PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {BuilderIndex} from "@lodestar/types";
import {Logger, toHex} from "@lodestar/utils";

export async function resolveBuilderIdentity(
  api: ApiClient,
  logger: Logger,
  publicKeyHex: string
): Promise<BuilderIndex> {
  const builderRes = await api.beacon.getStateBuilders({
    stateId: "head",
    builderIds: [publicKeyHex],
  });

  if (!builderRes.ok) {
    throw Error(`Getting state builders from BN failed: ${builderRes.status}`);
  }

  const builders = builderRes.value();

  if (builders.length === 0) {
    throw Error(`Builder not registered: ${publicKeyHex}`);
  }

  const builderEntry = builders[0];

  if (builderEntry.status !== "active") {
    throw Error(`Builder not active: ${builderEntry.status}`);
  }

  if (builderEntry.builder.version !== PAYLOAD_BUILDER_VERSION) {
    throw Error(`Builder version mismatch: got ${builderEntry.builder.version}, expected ${PAYLOAD_BUILDER_VERSION}`);
  }

  logger.info("Builder identity resolved", {
    index: builderEntry.index,
    status: builderEntry.status,
    balanceGwei: builderEntry.builder.balance,
    executionAddress: toHex(builderEntry.builder.executionAddress),
  });

  return builderEntry.index;
}
