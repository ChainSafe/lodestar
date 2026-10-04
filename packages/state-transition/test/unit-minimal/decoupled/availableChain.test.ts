import {describe, expect, it} from "vitest";
import {PAYLOAD_STATUS_EMPTY, PAYLOAD_STATUS_FULL, PAYLOAD_STATUS_PENDING, SLOTS_PER_EPOCH} from "@lodestar/params";
import {DcHarness} from "./harness.js";

const N = 64;

describe("decoupled available chain attestations (scripted votes)", () => {
  it("same-slot attestation with an empty payload status records builder payment participation", () => {
    const h = new DcHarness(N);
    h.produceBlock(1);
    const committee = h.availableChainCommittee(2, 1);
    const voters = committee.slice(0, Math.max(1, committee.length - 1));
    const attestation = h.availableChainVote(
      2,
      {root: h.blockRoot(1), slot: 1, payloadStatus: PAYLOAD_STATUS_EMPTY},
      voters
    );
    h.produceBlock(2, {availableChainAttestations: [attestation]});

    const participation = Array.from(h.state.builderPaymentParticipation.getReadonly(SLOTS_PER_EPOCH + 1).getAll());
    expect(participation).toEqual(voters);
  });

  it("re-submitting the same attesters does not duplicate participation", () => {
    const h = new DcHarness(N);
    h.produceBlock(1);
    const voters = h.availableChainCommittee(2, 1);
    const data = {root: h.blockRoot(1), slot: 1, payloadStatus: PAYLOAD_STATUS_EMPTY};
    h.produceBlock(2, {
      availableChainAttestations: [h.availableChainVote(2, data, voters), h.availableChainVote(2, data, voters)],
    });
    const participation = Array.from(h.state.builderPaymentParticipation.getReadonly(SLOTS_PER_EPOCH + 1).getAll());
    expect(participation).toEqual(voters);
  });

  it("same-slot attestation must carry an empty payload status", () => {
    const h = new DcHarness(N);
    h.produceBlock(1);
    const voters = h.availableChainCommittee(2, 1);
    const attestation = h.availableChainVote(
      2,
      {root: h.blockRoot(1), slot: 1, payloadStatus: PAYLOAD_STATUS_FULL},
      voters
    );
    expect(() => h.produceBlock(2, {availableChainAttestations: [attestation]})).toThrow(
      /Invalid available chain attestation/
    );
  });

  it("a skipped-slot attestation may vote FULL but not PENDING, and does not count towards payments", () => {
    const h = new DcHarness(N);
    h.produceBlock(1);
    // slot 2 is skipped, an attestation for slot 2 names the slot-1 block root
    const voters = h.availableChainCommittee(3, 2);
    const full = h.availableChainVote(3, {root: h.blockRoot(1), slot: 2, payloadStatus: PAYLOAD_STATUS_FULL}, voters);
    h.produceBlock(3, {availableChainAttestations: [full]});
    expect(h.state.builderPaymentParticipation.getReadonly(SLOTS_PER_EPOCH + 2).length).toBe(0);

    const h2 = new DcHarness(N);
    h2.produceBlock(1);
    const voters2 = h2.availableChainCommittee(3, 2);
    const pending = h2.availableChainVote(
      3,
      {root: h2.blockRoot(1), slot: 2, payloadStatus: PAYLOAD_STATUS_PENDING},
      voters2
    );
    expect(() => h2.produceBlock(3, {availableChainAttestations: [pending]})).toThrow(
      /Invalid available chain attestation/
    );
  });

  it("rejects attesters outside the committee and attestations included too early", () => {
    const h = new DcHarness(N);
    h.produceBlock(1);
    const committee = new Set(h.availableChainCommittee(2, 1));
    const outsider = Array.from({length: N}, (_, i) => i).find((i) => !committee.has(i));
    if (outsider === undefined) throw Error("every validator is in the committee");
    const bad = h.availableChainVote(2, {root: h.blockRoot(1), slot: 1, payloadStatus: PAYLOAD_STATUS_EMPTY}, [
      outsider,
    ]);
    expect(() => h.produceBlock(2, {availableChainAttestations: [bad]})).toThrow(/Invalid available chain attestation/);

    const h2 = new DcHarness(N);
    const voters = h2.availableChainCommittee(1, 1);
    const early = h2.availableChainVote(
      1,
      {root: new Uint8Array(32), slot: 1, payloadStatus: PAYLOAD_STATUS_EMPTY},
      voters
    );
    expect(() => h2.produceBlock(1, {availableChainAttestations: [early]})).toThrow(
      /Invalid available chain attestation/
    );
  });

  it("epoch processing shifts builder payment participation", () => {
    const h = new DcHarness(N);
    h.produceBlock(1);
    const voters = h.availableChainCommittee(2, 1);
    h.produceBlock(2, {
      availableChainAttestations: [
        h.availableChainVote(2, {root: h.blockRoot(1), slot: 1, payloadStatus: PAYLOAD_STATUS_EMPTY}, voters),
      ],
    });
    h.advanceTo(SLOTS_PER_EPOCH);
    expect(Array.from(h.state.builderPaymentParticipation.getReadonly(1).getAll())).toEqual(voters);
    expect(h.state.builderPaymentParticipation.getReadonly(SLOTS_PER_EPOCH + 1).length).toBe(0);
  });
});
