#!/bin/bash

# HOW TO:
# ```
# NODE_COUNT=4 docker/run.sh
# ```

# Build prometheus.yml file
node docker/build_prometheus_yml.mjs docker/prometheus/prometheus.yml

# Run docker
docker-compose -f docker/docker-compose.local.yml up -d --build
