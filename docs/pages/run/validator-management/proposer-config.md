# Proposer Configuration

:::warning
This is an alpha feature. The feature and its format are subject to change.
:::

With Lodestar's validator client, you can assign specific metadata for each proposer/public key using a proposer configuration file written in YAML file. This will allow you to set specific graffiti, fee recipients and builder settings per validator key.

### Example proposer_config.yaml

```yaml
proposer_config:
  "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c":
    graffiti: "graffiti"
    strict_fee_recipient_check: false
    fee_recipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    builder:
      enabled: true
      gas_limit: "30000000"
      selection: "executionalways"
      boost_factor: "0"
  "0xa4855c83d868f772a579133d9f23818008417b743e8447e235d8eb78b1d8f8a9f63f98c551beb7de254400f89592314d":
    fee_recipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    builder:
      enabled: "true"
      gas_limit: "3000000"
      selection: "maxprofit"
      boost_factor: "100"
default_config:
  graffiti: "default graffiti"
  strict_fee_recipient_check: true
  fee_recipient: "0xcccccccccccccccccccccccccccccccccccccccc"
  builder:
    enabled: true
    gas_limit: "30000000"
    selection: "default"
    boost_factor: "90"
```

### Enable Proposer Configuration

After you have configured your proposer configuration YAML file, you can start Lodestar with an additional CLI flag option pointing to the file: `--proposerSettingsFile /path/to/proposer_config.yaml`.
