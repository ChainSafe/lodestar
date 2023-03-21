# syntax=docker/dockerfile:1.4

# Same version as our ansible deployments, to minimize the diff in the dashboard on export
FROM grafana/grafana:8.5.20

# Datasource URL is configured with ENV variables
COPY datasource.yml /etc/grafana/provisioning/datasources/datasource.yml
# Note: Dashboard as linked via a bind volume
COPY dashboard.yml /etc/grafana/provisioning/dashboards/dashboard.yml
# copy over some reasonable default dashboards, user can mount a volume over top of it
COPY --from=dashboards . /dashboards/
VOLUME /dashboards

ENV GF_SECURITY_ADMIN_USER=admin
ENV GF_SECURITY_ADMIN_PASSWORD=admin

# Modified datasource to work with a network_mode: host
ENV PROMETHEUS_URL=http://prometheus:9090
ENV DASHBOARDS_DIR=/dashboards

CMD [ \
  "--homepath=/usr/share/grafana", \
  "--packaging=docker", \
  "cfg:default.paths.data=/var/lib/grafana" \
  ]
