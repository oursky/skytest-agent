{{- define "skytest-agent.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "skytest-agent.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "skytest-agent.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "skytest-agent.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "skytest-agent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "skytest-agent.selectorLabels" -}}
app.kubernetes.io/name: {{ include "skytest-agent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "skytest-agent.image" -}}
{{- printf "%s:%s" .Values.image.repository .Values.image.tag -}}
{{- end -}}

{{- define "skytest-agent.controlPlaneFullname" -}}
{{- printf "%s-control-plane" (include "skytest-agent.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "skytest-agent.runnerMaintenanceFullname" -}}
{{- printf "%s-runner-maintenance" (include "skytest-agent.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "skytest-agent.browserWorkerFullname" -}}
{{- printf "%s-browser-worker" (include "skytest-agent.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
