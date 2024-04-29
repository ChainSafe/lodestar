FROM prom/prometheus:latest

COPY prometheus.yml /etc/prometheus/prometheus.yml
COPY --chown=nobody:nobody entrypoint.sh /etc/prometheus/entrypoint.sh
RUN chmod +x /etc/prometheus/entrypoint.sh

ENV BEACON_URL='host.docker.internal:8008'
ENV VC_URL='host.docker.internal:5064'
VOLUME /prometheus

ENTRYPOINT ["/etc/prometheus/entrypoint.sh"]

CMD [ \
  "--config.file=/etc/prometheus/prometheus.yml", \
  "--storage.tsdb.path=/prometheus" \
  ]
