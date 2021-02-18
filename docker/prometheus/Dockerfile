FROM prom/prometheus:latest

# Modified datasource to work with a network_mode: host
ARG config_file=./prometheus.yml
COPY ${config_file} /etc/prometheus/prometheus.yml

CMD [ \
  "--config.file=/etc/prometheus/prometheus.yml", \
  "--storage.tsdb.path=/prometheus" \
  ]
