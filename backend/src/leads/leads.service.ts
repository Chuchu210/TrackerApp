import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NexoquoteLeadDto } from './dto/nexoquote-lead.dto';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(private readonly config: ConfigService) {}

  async forwardNexoquoteLead(dto: NexoquoteLeadDto): Promise<{ ok: boolean; reason?: string }> {
    const url = this.config.get<string>('NEXOQUOTE_LEADS_SHEET_URL');
    if (!url) {
      this.logger.warn('NEXOQUOTE_LEADS_SHEET_URL is not set — lead not forwarded to Google Sheets');
      return { ok: false, reason: 'not_configured' };
    }

    const body = new URLSearchParams({
      timestamp: dto.timestamp || new Date().toISOString(),
      name: dto.name || '',
      phone: dto.phone || '',
      zip: dto.zip || '',
      state: dto.state || '',
      insured: dto.insured || dto.q1 || '',
      vehicles: dto.vehicles || dto.q2 || '',
      homeowner: dto.homeowner || dto.q3 || '',
    });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) {
        this.logger.warn(`Google Sheets forward failed: HTTP ${res.status}`);
        return { ok: false, reason: 'upstream_error' };
      }
      return { ok: true };
    } catch (err) {
      this.logger.warn(`Google Sheets forward error: ${(err as Error).message}`);
      return { ok: false, reason: 'upstream_error' };
    }
  }
}
