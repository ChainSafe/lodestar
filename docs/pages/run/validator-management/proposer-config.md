# Proposer Configuration

:::warning
This is an alpha feature. The feature and its format are subject to change.
:::

With Lodestar's validator client, you can assign specific metadata for each proposer/public key using a proposer configuration file written in YAML file. This will allow you to set specific graffiti, fee recipients and builder settings per validator key.

When graffiti is supplied by the validator client, the connected Lodestar beacon node appends CL/EL client information to the graffiti by default if there is enough space left. If you do not want to have the beacon node announce the client its running use the [`--graffitiAppend false`](../beacon-management/beacon-cli.md#--graffitiappend) flag to disable this behavior.

### Example proposer_config.yaml

```yaml
proposer_config:
  "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c":
    graffiti: "graffiti"
    strict_fee_recipient_check: false
    fee_recipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    builder:
      gas_limit: "60000000"
      selection: "executionalways"
      boost_factor: "0"
  "0xa4855c83d868f772a579133d9f23818008417b743e8447e235d8eb78b1d8f8a9f63f98c551beb7de254400f89592314d":
    fee_recipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    builder:
      gas_limit: "45000000"
      selection: "maxprofit"
      boost_factor: "100"
      min_bid: "10000000"
      max_execution_payment: "0"
default_config:
  graffiti: "default graffiti"
  strict_fee_recipient_check: true
  fee_recipient: "0xcccccccccccccccccccccccccccccccccccccccc"
  builder:
    gas_limit: "60000000"
    selection: "default"
    boost_factor: "90"
```

### Builder settings from Gloas

`min_bid` is a floor in Gwei on the counted total payment, applied to p2p and builder API bids alike. `max_execution_payment` caps the execution layer payment in Gwei counted toward a builder API bid, values above `0` require `--allowDangerousTrustedPayments`. It has no effect without builder entries, p2p bids never carry an execution payment.

`boost_factor` applies to the p2p bid, while each builder's own `builder_boost_factor` applies to that builder's API bid. An explicitly configured per-validator `boost_factor` takes precedence over `selection`.

`builders` lists the builders to request bids from, with the same per-builder entries as the keymanager builder config API. Each entry has a required `url` and optional `auth_data`, `builder_pubkeys`, `max_execution_payment`, `min_bid` and `builder_boost_factor`, the last three defaulting to the values set on the builder section. Multiple entries may share a `url` only if they have distinct `auth_data`. Per-key entries replace the builders the validator client is configured with; setting both `--builder.urls` and `builders` in `default_config` is an error.

```yaml
builder:
  min_bid: "10000000"
  builders:
    - url: "https://builder-a.example.com"
    - url: "https://builder-b.example.com"
      auth_data: "0x0123"
      builder_boost_factor: "200"
```

### Enable Proposer Configuration

After you have configured your proposer configuration YAML file, you can start Lodestar with an additional CLI flag option pointing to the file: `--proposerSettingsFile /path/to/proposer_config.yaml`.

:::info
The proposer configuration can also be retrieved via the keymanager API endpoint:

```
GET /eth/v0/validator/{pubkey}/proposer_config
```

:::
