import {describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {PubkeyHex} from "@lodestar/api/keymanager";
import {Validator} from "@lodestar/validator";
import {KeymanagerApi} from "../../../../../src/cmds/validator/keymanager/impl.js";
import {IPersistedKeysBackend} from "../../../../../src/cmds/validator/keymanager/interface.js";

describe("KeymanagerApi", () => {
  it("returns all proposer config fields as JSON-safe values", async () => {
    const pubkey = `0x${"11".repeat(48)}` as PubkeyHex;
    const validator = {
      validatorStore: {
        hasVotingPubkey: vi.fn().mockReturnValue(true),
        getProposerConfig: vi.fn().mockReturnValue({
          graffiti: "graffiti",
          strictFeeRecipientCheck: true,
          feeRecipient: "0x2222222222222222222222222222222222222222",
          builder: {
            gasLimit: 30_000_000,
            selection: routes.validator.BuilderSelection.MaxProfit,
            boostFactor: 0n,
            minBid: 1n,
            maxExecutionPayment: 2n,
            builders: [
              {
                url: "https://builder.example.com",
                authData: "0x1234",
                builderPubkeys: [pubkey],
                maxExecutionPayment: 3n,
                minBid: 4n,
                builderBoostFactor: 5n,
              },
            ],
          },
        }),
      },
    } as unknown as Validator;
    const api = new KeymanagerApi(validator, {} as IPersistedKeysBackend, new AbortController().signal);

    const response = await api.getProposerConfig({pubkey});

    expect(response).toEqual({
      data: {
        graffiti: "graffiti",
        strictFeeRecipientCheck: true,
        feeRecipient: "0x2222222222222222222222222222222222222222",
        builder: {
          gasLimit: 30_000_000,
          selection: routes.validator.BuilderSelection.MaxProfit,
          boostFactor: "0",
          minBid: "1",
          maxExecutionPayment: "2",
          builders: [
            {
              url: "https://builder.example.com",
              authData: "0x1234",
              builderPubkeys: [pubkey],
              maxExecutionPayment: "3",
              minBid: "4",
              builderBoostFactor: "5",
            },
          ],
        },
      },
    });
    expect(() => JSON.stringify(response)).not.toThrow();
  });
});
