import {
  meetsMinSeverity,
  formatAlertText,
  buildWebhookPayload,
  type AlertLike,
} from '../src/notifications/notification-format';

const baseAlert: AlertLike = {
  severity: 'danger',
  title: 'ROI alert: Campaign X',
  message: 'ROI -42% with $120 spend.',
  suggestedAction: 'Reduce budget or pause campaign.',
  entityLabel: 'Campaign X',
  metricValue: -42,
  campaignId: 'camp_1',
};

describe('meetsMinSeverity', () => {
  it('passes when severity is at or above the threshold', () => {
    expect(meetsMinSeverity('danger', 'warning')).toBe(true);
    expect(meetsMinSeverity('warning', 'warning')).toBe(true);
    expect(meetsMinSeverity('danger', 'danger')).toBe(true);
  });

  it('blocks when severity is below the threshold', () => {
    expect(meetsMinSeverity('info', 'warning')).toBe(false);
    expect(meetsMinSeverity('warning', 'danger')).toBe(false);
  });

  it('treats success/info as lowest urgency', () => {
    expect(meetsMinSeverity('success', 'warning')).toBe(false);
    expect(meetsMinSeverity('info', 'info')).toBe(true);
  });

  it('defaults unknown severities to lowest rank', () => {
    expect(meetsMinSeverity('bogus', 'warning')).toBe(false);
  });
});

describe('formatAlertText', () => {
  it('includes title, message and action', () => {
    const text = formatAlertText(baseAlert);
    expect(text).toContain('ROI alert: Campaign X');
    expect(text).toContain('ROI -42% with $120 spend.');
    expect(text).toContain('Action: Reduce budget or pause campaign.');
  });

  it('omits the action line when none is provided', () => {
    const text = formatAlertText({ ...baseAlert, suggestedAction: null });
    expect(text).not.toContain('Action:');
  });
});

describe('buildWebhookPayload', () => {
  it('produces a structured payload with a text fallback', () => {
    const payload = buildWebhookPayload(baseAlert);
    expect(payload.type).toBe('alert');
    expect(payload.severity).toBe('danger');
    expect(payload.campaignId).toBe('camp_1');
    expect(typeof payload.text).toBe('string');
    expect(typeof payload.sentAt).toBe('string');
  });
});
