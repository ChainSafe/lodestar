# Client monitoring

Lodestar has the ability to send client stats to a remote service for collection.
At the moment, the main service offering remote monitoring is [beaconcha.in](https://beaconcha.in/).

Instructions for setting up client monitoring with *beaconcha.in* can be found in their docs about
[Mobile App <> Node Monitoring](https://kb.beaconcha.in/beaconcha.in-explorer/mobile-app-less-than-greater-than-beacon-node)
and in your [account settings](https://beaconcha.in/user/settings#app).

## Configuration

Lodestar provides CLI options to configure monitoring on both the beacon node and validator client.

### Remote endpoint URL

Client monitoring can be enabled by setting the `--monitoring.endpoint` flag to a remote service endpoint URL.
As monitoring relies on metrics data, it is required that metrics are also enabled by supplying the `--metrics` flag.

```bash
lodestar beacon --monitoring.endpoint "https://beaconcha.in/api/v1/client/metrics?apikey={apikey}&machine={machineName}" --metrics
```

In case of *beaconcha.in*, the API key can be found in your [account settings](https://beaconcha.in/user/settings#api).
Setting the machine is optional but it is especially useful if you are monitoring multiple nodes.

<!-- prettier-ignore-start -->
!!! note
    When sending data to a remote service you should be conscious about security:

    - Only use a service that you trust as this will send information which may identify you
      and associate your validators, IP address and other personal information.
    - Always use a HTTPS connection (i.e. a URL starting with `https://`) to prevent the traffic
      from being intercepted in transit and leaking information.
<!-- prettier-ignore-end -->

More details about the data sent to the remote service can be found in the [specification](https://docs.google.com/document/d/1qPWAVRjPCENlyAjUBwGkHMvz9qLdd_6u9DPZcNxDBpc).

It is also possible to print out the data sent to the remote service by enabling debug logs which can be done by supplying the `--logLevel debug` flag.

### Monitoring interval

It is possible to adjust the interval between sending client stats to the remote service by setting the `--monitoring.interval` flag.
It takes an integer value in milliseconds, the default is `60000` which means data is sent once a minute.

For example, setting an interval of `300000` would mean the data is only sent every 5 minutes.

```bash
lodestar beacon --monitoring.interval 300000
```

Increasing the monitoring interval can be useful if you are running into rate limit errors when posting large amounts of data for multiple nodes.
