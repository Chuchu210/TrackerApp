export type NotifySeverity = 'info' | 'warning' | 'danger' | 'success';

const SEVERITY_RANK: Record<NotifySeverity, number> = {
  info: 0,
  success: 0,
  warning: 1,
  danger: 2,
};

const SEVERITY_EMOJI: Record<NotifySeverity, string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  danger: '🚨',
};

export interface AlertLike {
  severity: string;
  title: string;
  message: string;
  suggestedAction?: string | null;
  entityLabel?: string | null;
  metricValue?: number | null;
  campaignId?: string | null;
}

/** True when `severity` is at least as urgent as `minSeverity`. */
export function meetsMinSeverity(severity: string, minSeverity: string): boolean {
  const s = SEVERITY_RANK[severity as NotifySeverity] ?? 0;
  const min = SEVERITY_RANK[minSeverity as NotifySeverity] ?? 0;
  return s >= min;
}

/** Plain-text message body shared by Telegram and webhook payloads. */
export function formatAlertText(alert: AlertLike): string {
  const emoji = SEVERITY_EMOJI[alert.severity as NotifySeverity] || '•';
  const lines = [`${emoji} ${alert.title}`, '', alert.message];
  if (alert.suggestedAction) {
    lines.push('', `Action: ${alert.suggestedAction}`);
  }
  return lines.join('\n');
}

/** Structured payload delivered to a generic webhook. */
export function buildWebhookPayload(alert: AlertLike): Record<string, unknown> {
  return {
    type: 'alert',
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    suggestedAction: alert.suggestedAction ?? null,
    entityLabel: alert.entityLabel ?? null,
    metricValue: alert.metricValue ?? null,
    campaignId: alert.campaignId ?? null,
    text: formatAlertText(alert),
    sentAt: new Date().toISOString(),
  };
}
