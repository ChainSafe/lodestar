FROM prom/prometheus:latest
COPY prometheus.yml /src/prometheus/

CMD [ "--config.file=/etc/prometheus/prometheus.yml", \
      "--storage.tsdb.path=/prometheus" \
    ]
