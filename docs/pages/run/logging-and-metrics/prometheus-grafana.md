# Prometheus and Grafana Setup

Prometheus is an open-source monitoring system with efficient time series database and a modern alerting approach. Together with Grafana it's the recommended way to make sure that your node and validator(s) are performing correctly.

## Localized Docker Metrics Script

The Lodestar team has setup a script which will copy the latest dashboards compiled by our team for development purposes. By utilizing the script located in `/docker/docker-compose.local_dev.sh`, you can instantly setup the latest dockerized metrics alongside your local beacon node.

## Prometheus Setup

To start, download Prometheus from https://prometheus.io/download/.
Unzip the downloaded .zip file and run Prometheus from its installed location with the lodestar `prometheus.yml` passed in as the configuration file

```sh
./prometheus --config.file=$dataDir/prometheus.yml
```

:::info
8008 is also the default port specified in the `prometheus.yml` in the lodestar repository
:::

Then run the Lodestar beacon node with

```sh
lodestar --metrics=true --metrics.port=8008
```

Navigate to http://localhost:9090/ in your browser to verify that Prometheus is monitoring Lodestar

## Grafana Setup

Download and install Grafana from its official repository https://grafana.com/docs/grafana/latest/installation/debian/

Add Prometheus as a data source to Grafana https://prometheus.io/docs/visualization/grafana/#installing

An example of relevant metrics of interest to monitor are:

- `nodejs_heap_space_size_used_bytes`
- `nodejs_eventloop_lag_seconds`
- `beaconchain_peers`
- `beaconchain_current_slot`
- `beaconchain_current_finalized_epoch`
