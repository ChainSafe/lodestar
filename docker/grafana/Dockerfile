# Same version as our ansible deployments, to minimize the diff in the dashboard on export
FROM grafana/grafana:8.4.2

# Datasource URL is configured with ENV variables
COPY datasource.yml /etc/grafana/provisioning/datasources/datasource.yml
# Note: Dashboard as linked via a bind volume
COPY dashboard.yml /etc/grafana/provisioning/dashboards/dashboard.yml

# Set GF_SECURITY_ADMIN_PASSWORD=your-password to the root .env file
ARG GF_SECURITY_ADMIN_PASSWORD
ENV GF_SECURITY_ADMIN_USER=admin \
  GF_SECURITY_ADMIN_PASSWORD=${GF_SECURITY_ADMIN_PASSWORD}

# Modified datasource to work with a network_mode: host
ENV PROMETHEUS_URL=http://prometheus:9090
ENV DASHBOARDS_DIR=/dashboards

CMD [ \
  "--homepath=/usr/share/grafana", \
  "--packaging=docker", \
  "cfg:default.paths.data=/var/lib/grafana" \
  ]