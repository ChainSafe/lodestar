import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {ACTIVE_PRESET, ForkName, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {ssz, sszTypesFor} from "@lodestar/types";
import {ServingContext} from "../../../../src/chain/serving/context.js";
import {serializeServingValue} from "../../../../src/chain/serving/serialization.js";
import {resolveServingPolicy} from "../../../../src/network/reqresp/serving/policy.js";

export function servingConfig(blobs = 21) {
  return createBeaconConfig(
    {
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 1,
      CAPELLA_FORK_EPOCH: 2,
      DENEB_FORK_EPOCH: 3,
      ELECTRA_FORK_EPOCH: 4,
      FULU_FORK_EPOCH: 5,
      GLOAS_FORK_EPOCH: Infinity,
      BLOB_SCHEDULE: [{EPOCH: 5, MAX_BLOBS_PER_BLOCK: blobs}],
    },
    new Uint8Array(32)
  );
}

export function measureOwners(values: unknown[]): {bytes: number; byteArrays: number; arrays: number; objects: number} {
  const pending = [...values];
  let bytes = 0,
    byteArrays = 0,
    arrays = 0,
    objects = 0;
  for (let visits = 0; pending.length; visits++) {
    if (visits >= 8192 || pending.length > 4096) throw Error("Fixture owner bound");
    const value = pending.pop();
    if (value instanceof Uint8Array) {
      bytes += value.buffer.byteLength;
      byteArrays++;
    } else if (Array.isArray(value)) {
      arrays++;
      pending.push(...value);
    } else if (value && typeof value === "object") {
      objects++;
      pending.push(...Object.values(value));
    }
  }
  return {bytes, byteArrays, arrays, objects};
}

export function registerServingSchemaCases(): void {
  describe("serving schema envelope", () => {
    for (const fork of [
      ForkName.altair,
      ForkName.bellatrix,
      ForkName.capella,
      ForkName.deneb,
      ForkName.electra,
      ForkName.fulu,
    ] as const) {
      it(`bounds concrete decoded ${fork} inputs and exact serialization`, () => {
        const policy = resolveServingPolicy(servingConfig(), {boundedReadVersion: 1}, 6, 0);
        const types = sszTypesFor(fork);
        const committeeBytes = ssz.altair.SyncCommittee.serialize(ssz.altair.SyncCommittee.defaultValue());
        const current = ssz.altair.SyncCommittee.deserialize(committeeBytes);
        const next = ssz.altair.SyncCommittee.deserialize(committeeBytes);
        const header = types.LightClientHeader.defaultValue();
        if ("execution" in header) header.execution.extraData = new Uint8Array(32);
        const decodedHeader = types.LightClientHeader.deserialize(types.LightClientHeader.serialize(header));
        const bootstrap = types.LightClientBootstrap.defaultValue();
        bootstrap.header = decodedHeader;
        bootstrap.currentSyncCommittee = current;
        const witness = {
          witness: Array.from(
            {length: fork === ForkName.electra || fork === ForkName.fulu ? 5 : 4},
            () => new Uint8Array(32)
          ),
          currentSyncCommitteeRoot: new Uint8Array(32),
          nextSyncCommitteeRoot: new Uint8Array(32),
        };
        bootstrap.currentSyncCommitteeBranch = [witness.nextSyncCommitteeRoot, ...witness.witness];
        const owners = measureOwners([witness, current, next, decodedHeader, bootstrap.currentSyncCommitteeBranch]);
        expect(owners.bytes).toBeLessThanOrEqual(policy.lightClient.decodedBytes);
        expect(owners.byteArrays + owners.arrays + owners.objects).toBeLessThanOrEqual(policy.lightClient.metadata);
        expect(current.pubkeys).toHaveLength(SYNC_COMMITTEE_SIZE);
        expect(current.pubkeys[0].buffer).not.toBe(committeeBytes.buffer);
        const update = types.LightClientUpdate.defaultValue();
        if ("execution" in update.attestedHeader) update.attestedHeader.execution.extraData = new Uint8Array(32);
        if ("execution" in update.finalizedHeader) update.finalizedHeader.execution.extraData = new Uint8Array(32);
        const decoded = types.LightClientUpdate.deserialize(types.LightClientUpdate.serialize(update));
        const updateOwners = measureOwners([decoded, decoded]);
        expect(updateOwners.bytes).toBeLessThanOrEqual(policy.lightClient.decodedBytes);
        expect(updateOwners.byteArrays + updateOwners.arrays + updateOwners.objects).toBeLessThanOrEqual(
          policy.lightClient.metadata
        );
        console.info(
          "serving owners",
          JSON.stringify({
            preset: ACTIVE_PRESET,
            fork,
            bootstrap: owners,
            twoUpdates: updateOwners,
            allowanceBytes: policy.decodedBytes,
          })
        );
        const context = new ServingContext(policy);
        for (const [type, value] of [[types.LightClientBootstrap, bootstrap]] as const) {
          const bytes = serializeServingValue(type, value, context, type.maxSize);
          expect(bytes).toEqual(type.serialize(value));
          expect(bytes.buffer.byteLength).toBe(bytes.byteLength);
        }
      });
    }
  });
}
