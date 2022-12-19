FROM prom/prometheus:latest

COPY prometheus.yml /etc/prometheus/prometheus.yml
COPY entrypoint.sh /prometheus/entrypoint.sh

# Modified datasource to work with a network_mode: host
# Docker DNS: "beacon_node:8008"
# net host: "localhost:8008"
# MacOSX: "host.docker.internal:8008"
ENV BEACON_URL='beacon_node:8008'
ENV VC_URL='validator'

ENTRYPOINT ["/prometheus/entrypoint.sh"]

CMD [ \
  "--config.file=/etc/prometheus/prometheus.yml", \
  "--storage.tsdb.path=/prometheus" \
  ]
