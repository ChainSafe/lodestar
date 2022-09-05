# Prometheus and Grafana

Prometheus is an open-source monitoring system with efficient time series database and a modern alerting approach. Together with Grafana it's the recommended way to make sure that your node and validator(s) are performing correctly.

## Prometheus

To start, download Prometheus from https://prometheus.io/download/.
Unzip the downloaded .zip file and run Prometheus from its installed location with the lodestar prometheus.yml passed in as the config file

```
./prometheus --config.file=$dataDir/prometheus.yml
```

<!-- prettier-ignore-start -->
!!! info
    8008 is also the default port specified in the prometheus.yml in the lodestar repo
<!-- prettier-ignore-end -->

Then run the Lodestar beacon node with

```
lodestar --metrics=true --metrics.serverPort=8008
```

Navigate to http://localhost:9090/ in your browser to verify that Prometheus is monitoring Lodestar

## Grafana

Download and install Grafana from its official repository https://grafana.com/docs/grafana/latest/installation/debian/

Add Prometheus as a data source to Grafana https://prometheus.io/docs/visualization/grafana/#installing

An example of relevant metrics of interest to monitor are:

- `nodejs_heap_space_size_used_bytes`
- `nodejs_eventloop_lag_seconds`
- `beaconchain_peers`
- `beaconchain_current_slot`
- `beaconchain_current_finalized_epoch`
