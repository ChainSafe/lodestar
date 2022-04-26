FROM prom/prometheus:latest

COPY prometheus.yml /etc/prometheus/prometheus.yml

# Modified datasource to work with a network_mode: host
# Docker DNS: "beacon_node:8008"
# net host: "localhost:8008"
# MacOSX: "host.docker.internal:8008"
ARG BEACON_URL=beacon_node:8008
RUN sed -i 's/#BEACON_URL/'"$BEACON_URL"'/' /etc/prometheus/prometheus.yml
RUN cat /etc/prometheus/prometheus.yml

CMD [ \
  "--config.file=/etc/prometheus/prometheus.yml", \
  "--storage.tsdb.path=/prometheus" \
  ]
