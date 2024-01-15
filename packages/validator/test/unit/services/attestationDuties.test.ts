import {describe, it, expect, beforeAll, vi, Mocked, beforeEach, afterEach} from "vitest";
import {toBufferBE} from "bigint-buffer";
import bls from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {chainConfig} from "@lodestar/config/default";
import {HttpStatusCode, routes} from "@lodestar/api";
import {ssz} from "@lodestar/types";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {AttestationDutiesService} from "../../../src/services/attestationDuties.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub} from "../../utils/apiStub.js";
import {loggerVc} from "../../utils/logger.js";
import {ClockMock} from "../../utils/clock.js";
import {initValidatorStore} from "../../utils/validatorStore.js";
import {ChainHeaderTracker} from "../../../src/services/chainHeaderTracker.js";
import {ZERO_HASH_HEX} from "../../utils/types.js";

vi.mock("../../../src/services/chainHeaderTracker.js");

describe("AttestationDutiesService", function () {
  const api = getApiClientStub();

  let validatorStore: ValidatorStore;

  // @ts-expect-error - Mocked class don't need parameters
  const chainHeadTracker = new ChainHeaderTracker() as Mocked<ChainHeaderTracker>;
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  // Sample validator
  const index = 4;
  // Sample validator
  const defaultValidator: routes.beacon.ValidatorResponse = {
    index,
    balance: 32e9,
    status: "active",
    validator: ssz.phase0.Validator.defaultValue(),
  };

  beforeAll(async () => {
    const secretKeys = [bls.SecretKey.fromBytes(toBufferBE(BigInt(98), 32))];
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
    validatorStore = await initValidatorStore(secretKeys, api, chainConfig);
  });

  let controller: AbortController; // To stop clock
  beforeEach(() => {
    controller = new AbortController();
  });
  afterEach(() => controller.abort());

  it("Should fetch indexes and duties", async function () {
    // Reply with an active validator that has an index
    const validatorResponse = {
      ...defaultValidator,
      index,
      validator: {...defaultValidator.validator, pubkey: pubkeys[0]},
    };
    api.beacon.getStateValidators.mockResolvedValue({
      response: {data: [validatorResponse], executionOptimistic: false},
      ok: true,
      status: HttpStatusCode.OK,
    });

    // Reply with some duties
    const slot = 1;
    const epoch = computeEpochAtSlot(slot);
    const duty: routes.validator.AttesterDuty = {
      slot: slot,
      committeeIndex: 1,
      committeeLength: 120,
      committeesAtSlot: 120,
      validatorCommitteeIndex: 1,
      validatorIndex: index,
      pubkey: pubkeys[0],
    };
    api.validator.getAttesterDuties.mockResolvedValue({
      response: {dependentRoot: ZERO_HASH_HEX, data: [duty], executionOptimistic: false},
      ok: true,
      status: HttpStatusCode.OK,
    });

    // Accept all subscriptions
    api.validator.prepareBeaconCommitteeSubnet.mockResolvedValue({
      response: undefined,
      ok: true,
      status: HttpStatusCode.OK,
    });

    // Clock will call runAttesterDutiesTasks() immediately
    const clock = new ClockMock();
    const dutiesService = new AttestationDutiesService(loggerVc, api, clock, validatorStore, chainHeadTracker, null);

    // Trigger clock onSlot for slot 0
    await clock.tickEpochFns(0, controller.signal);

    // Validator index should be persisted
    expect(validatorStore.getAllLocalIndices()).toEqual([index]);
    expect(validatorStore.getPubkeyOfIndex(index)).toBe(toHexString(pubkeys[0]));

    // Duties for this and next epoch should be persisted
    expect(Object.fromEntries(dutiesService["dutiesByIndexByEpoch"].get(epoch)?.dutiesByIndex || new Map())).toEqual({
      // Since the ZERO_HASH won't pass the isAggregator test, selectionProof is null
      [index]: {duty, selectionProof: null},
    });
    expect(
      Object.fromEntries(dutiesService["dutiesByIndexByEpoch"].get(epoch + 1)?.dutiesByIndex || new Map())
    ).toEqual({
      // Since the ZERO_HASH won't pass the isAggregator test, selectionProof is null
      [index]: {duty, selectionProof: null},
    });

    expect(dutiesService.getDutiesAtSlot(slot)).toEqual([{duty, selectionProof: null}]);

    expect(api.validator.prepareBeaconCommitteeSubnet).toHaveBeenCalledOnce();
  });

  it("Should remove signer from attestation duties", async function () {
    // Reply with an active validator that has an index
    const validatorResponse = {
      ...defaultValidator,
      index,
      validator: {...defaultValidator.validator, pubkey: pubkeys[0]},
    };
    api.beacon.getStateValidators.mockResolvedValue({
      response: {data: [validatorResponse], executionOptimistic: false},
      ok: true,
      status: HttpStatusCode.OK,
    });

    // Reply with some duties
    const slot = 1;
    const duty: routes.validator.AttesterDuty = {
      slot: slot,
      committeeIndex: 1,
      committeeLength: 120,
      committeesAtSlot: 120,
      validatorCommitteeIndex: 1,
      validatorIndex: index,
      pubkey: pubkeys[0],
    };
    api.validator.getAttesterDuties.mockResolvedValue({
      response: {data: [duty], dependentRoot: ZERO_HASH_HEX, executionOptimistic: false},
      ok: true,
      status: HttpStatusCode.OK,
    });

    // Accept all subscriptions
    api.validator.prepareBeaconCommitteeSubnet.mockResolvedValue({
      ok: true,
      status: HttpStatusCode.OK,
      response: undefined,
    });

    // Clock will call runAttesterDutiesTasks() immediately
    const clock = new ClockMock();
    const dutiesService = new AttestationDutiesService(loggerVc, api, clock, validatorStore, chainHeadTracker, null);

    // Trigger clock onSlot for slot 0
    await clock.tickEpochFns(0, controller.signal);

    // first confirm duties for this and next epoch should be persisted
    expect(Object.fromEntries(dutiesService["dutiesByIndexByEpoch"].get(0)?.dutiesByIndex || new Map())).toEqual({
      4: {duty: duty, selectionProof: null},
    });
    expect(Object.fromEntries(dutiesService["dutiesByIndexByEpoch"].get(1)?.dutiesByIndex || new Map())).toEqual({
      4: {duty: duty, selectionProof: null},
    });
    // then remove
    dutiesService.removeDutiesForKey(toHexString(pubkeys[0]));
    expect(Object.fromEntries(dutiesService["dutiesByIndexByEpoch"])).toEqual({});
  });
});
