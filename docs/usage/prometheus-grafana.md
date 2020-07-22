### Prometheus
* Download Prometheus
    * https://prometheus.io/download/
* Unzip the downloaded .zip file
* Run lodestar beacon node with ```--metrics.enabled=true``` and ```metrics.serverPort=8008``` 
    * *NOTE: 8008 is also the default port specified in the prometheus.yml in the lodestar repo*
* Run Prometheus from it's installed location with the lodestar prometheus.yml passed in as the config file
    * ```./prometheus --config.file=<lodestar-root-directory>/prometheus.yml```
* Navigate to http://localhost:9090/ in your browser to verify that Prometheus is monitoring Lodestar

### Grafana
* Download and install Grafana
    * https://grafana.com/docs/grafana/latest/installation/debian/
* Add Prometheus as a data source to Grafana
    * https://prometheus.io/docs/visualization/grafana/#installing

##### some fields you may want to try monitoring:
* nodejs_heap_space_size_used_bytes
* nodejs_eventloop_lag_seconds
* beaconchain_peers
* beaconchain_current_slot
* beaconchain_current_finalized_epoch