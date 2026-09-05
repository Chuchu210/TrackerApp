import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { SettingsService, type StoredSettings } from './settings.service';

@Controller('api/settings')
@UseGuards(ApiKeyGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.getStored();
  }

  @Put()
  update(@Body() body: Partial<StoredSettings>) {
    return this.settings.update(body);
  }

  /**
   * Test mode has its own pair of routes because the banner that reads it is
   * mounted on every page, and GET /api/settings carries the Telegram bot
   * token — no screen should have to fetch a credential to render a checkbox.
   */
  @Get('test-mode')
  async getTestMode(): Promise<{ enabled: boolean }> {
    return { enabled: await this.settings.isTestMode() };
  }

  @Put('test-mode')
  setTestMode(@Body() body: { enabled?: unknown }): Promise<{ enabled: boolean }> {
    return this.settings.setTestMode(body?.enabled === true);
  }
}
