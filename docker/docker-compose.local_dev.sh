#!/bin/bash

cp -r ./dashboards docker/grafana_dev/dashboards

docker-compose -f docker/docker-compose.local_dev.yml up --build
