'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';
import {
  Alert,
  Button,
  Card,
  Input,
  Label,
  Loading,
  Select,
  mutedTextClass,
  pageTitleClass,
  sectionHeadingClass,
} from '@/components/ui';
import { trackerApi, formatApiError, type AppSettings } from '@/lib/api';

type Form = {
  telegramBotToken: string;
  telegramChatId: string;
  notifyWebhookUrl: string;
  notifyMinSeverity: string;
  baseCurrency: string;
  fxRates: string;
  reportTimezone: string;
  fraudVelocityWindowSeconds: string;
  fraudVelocityMaxClicks: string;
};

function toForm(s: AppSettings): Form {
  return {
    telegramBotToken: s.telegramBotToken ?? '',
    telegramChatId: s.telegramChatId ?? '',
    notifyWebhookUrl: s.notifyWebhookUrl ?? '',
    notifyMinSeverity: s.notifyMinSeverity ?? 'warning',
    baseCurrency: s.baseCurrency ?? '',
    fxRates: s.fxRates ?? '',
    reportTimezone: s.reportTimezone ?? '',
    fraudVelocityWindowSeconds: s.fraudVelocityWindowSeconds?.toString() ?? '',
    fraudVelocityMaxClicks: s.fraudVelocityMaxClicks?.toString() ?? '',
  };
}

export default function SettingsPage() {
  const toast = useToast();
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    trackerApi
      .getSettings()
      .then((s) => setForm(toForm(s)))
      .catch((err) => setError(formatApiError(err)))
      .finally(() => setLoading(false));
  }, []);

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const payload: Partial<AppSettings> = {
        telegramBotToken: form.telegramBotToken,
        telegramChatId: form.telegramChatId,
        notifyWebhookUrl: form.notifyWebhookUrl,
        notifyMinSeverity: form.notifyMinSeverity,
        baseCurrency: form.baseCurrency,
        fxRates: form.fxRates,
        reportTimezone: form.reportTimezone,
        fraudVelocityWindowSeconds: form.fraudVelocityWindowSeconds
          ? parseInt(form.fraudVelocityWindowSeconds, 10)
          : null,
        fraudVelocityMaxClicks: form.fraudVelocityMaxClicks
          ? parseInt(form.fraudVelocityMaxClicks, 10)
          : null,
      };
      const updated = await trackerApi.updateSettings(payload);
      setForm(toForm(updated));
      toast.success('Settings saved');
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!form) return null;

  return (
    <div>
      <h1 className={`${pageTitleClass} mb-1`}>Settings</h1>
      <p className={`text-sm ${mutedTextClass} mb-6`}>
        Any field left blank falls back to the backend environment variable, then a built-in
        default. Changes take effect within 30 seconds.
      </p>

      <Card className="mb-6">
        <h2 className={`${sectionHeadingClass} mb-4`}>Notifications</h2>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Telegram bot token</Label>
              <Input
                value={form.telegramBotToken}
                onChange={(e) => set({ telegramBotToken: e.target.value })}
                placeholder="From @BotFather"
                className="font-mono text-sm"
              />
            </div>
            <div>
              <Label>Telegram chat ID</Label>
              <Input
                value={form.telegramChatId}
                onChange={(e) => set({ telegramChatId: e.target.value })}
                className="font-mono text-sm"
              />
            </div>
          </div>
          <div>
            <Label>Webhook URL (Slack / Zapier / email relay)</Label>
            <Input
              value={form.notifyWebhookUrl}
              onChange={(e) => set({ notifyWebhookUrl: e.target.value })}
              className="font-mono text-sm"
            />
          </div>
          <div className="w-48">
            <Label>Minimum severity</Label>
            <Select
              value={form.notifyMinSeverity}
              onChange={(e) => set({ notifyMinSeverity: e.target.value })}
            >
              <option value="info">Info and above</option>
              <option value="warning">Warning and above</option>
              <option value="danger">Danger only</option>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className={`${sectionHeadingClass} mb-4`}>Currency &amp; timezone</h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>Base currency</Label>
            <Input
              value={form.baseCurrency}
              onChange={(e) => set({ baseCurrency: e.target.value })}
              placeholder="USD"
            />
          </div>
          <div className="col-span-2">
            <Label>FX rates (base per 1 unit)</Label>
            <Input
              value={form.fxRates}
              onChange={(e) => set({ fxRates: e.target.value })}
              placeholder="EUR:1.08,GBP:1.27"
              className="font-mono text-sm"
            />
          </div>
        </div>
        <div className="w-64 mt-4">
          <Label>Report timezone (IANA)</Label>
          <Input
            value={form.reportTimezone}
            onChange={(e) => set({ reportTimezone: e.target.value })}
            placeholder="UTC"
          />
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className={`${sectionHeadingClass} mb-4`}>Fraud &amp; attribution</h2>
        <p className={`text-sm ${mutedTextClass} mb-4`}>
          Click-flood detection: if one IP produces at least the max clicks within the window, the
          click&apos;s bot score is raised. Attribution windows are set per campaign.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Velocity window (seconds)</Label>
            <Input
              type="number"
              value={form.fraudVelocityWindowSeconds}
              onChange={(e) => set({ fraudVelocityWindowSeconds: e.target.value })}
              placeholder="60"
            />
          </div>
          <div>
            <Label>Max clicks per IP in window</Label>
            <Input
              type="number"
              value={form.fraudVelocityMaxClicks}
              onChange={(e) => set({ fraudVelocityMaxClicks: e.target.value })}
              placeholder="20 (0 disables)"
            />
          </div>
        </div>
      </Card>

      <Button onClick={save} disabled={saving}>
        {saving ? 'Saving...' : 'Save settings'}
      </Button>
    </div>
  );
}
