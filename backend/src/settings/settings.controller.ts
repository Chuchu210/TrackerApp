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
}
