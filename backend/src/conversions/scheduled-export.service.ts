import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as fs from 'fs';
import * as path from 'path';
import { VoluumExportService } from './voluum-export.service';

/**
 * Scheduled data export. When EXPORT_ENABLED=true it writes a daily conversions
 * CSV to EXPORT_DIR and, if EXPORT_WEBHOOK_URL is set, POSTs the CSV there
 * (e.g. an S3/BigQuery ingestion endpoint). Disabled by default so it is a
 * no-op until configured.
 */
@Injectable()
export class ScheduledExportService {
  private readonly logger = new Logger(ScheduledExportService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly voluumExport: VoluumExportService,
    private readonly http: HttpService,
  ) {}

  @Cron('30 2 * * *')
  async scheduledDailyExport() {
    if ((this.config.get<string>('EXPORT_ENABLED') || 'false') !== 'true') return;
    await this.runExport();
  }

  /** Export the trailing window's conversions; returns where it was delivered. */
  async runExport(): Promise<{ file?: string; webhook?: boolean; rows: number }> {
    const windowDays = Number(this.config.get<string>('EXPORT_WINDOW_DAYS') || 1);
    const to = new Date();
    const from = new Date(to.getTime() - windowDays * 24 * 60 * 60 * 1000);

    const csv = await this.voluumExport.exportConversionsCsv({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const rows = Math.max(0, csv.split('\n').filter(Boolean).length - 1);

    const result: { file?: string; webhook?: boolean; rows: number } = { rows };
    const stamp = to.toISOString().slice(0, 10);
    const filename = `conversions-${stamp}.csv`;

    const dir = this.config.get<string>('EXPORT_DIR');
    if (dir) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, filename);
        fs.writeFileSync(filePath, csv);
        result.file = filePath;
      } catch (err) {
        this.logger.error(`Export file write failed: ${(err as Error).message}`);
      }
    }

    const webhookUrl = this.config.get<string>('EXPORT_WEBHOOK_URL');
    if (webhookUrl) {
      try {
        await firstValueFrom(
          this.http.post(webhookUrl, csv, {
            headers: { 'Content-Type': 'text/csv' },
            timeout: 15000,
          }),
        );
        result.webhook = true;
      } catch (err) {
        this.logger.error(`Export webhook POST failed: ${(err as Error).message}`);
      }
    }

    this.logger.log(`Scheduled export complete: ${rows} rows (${filename})`);
    return result;
  }
}
