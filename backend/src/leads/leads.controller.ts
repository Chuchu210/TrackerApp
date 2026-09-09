import { Body, Controller, Header, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { LeadsService } from './leads.service';
import { NexoquoteLeadDto } from './dto/nexoquote-lead.dto';

@Controller()
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  /** Public LP callback form → Google Sheet (via Apps Script URL in env). */
  @Post('leads/nexoquote')
  @UseGuards(ThrottlerGuard)
  @Header('Access-Control-Allow-Origin', '*')
  async nexoquote(@Body() dto: NexoquoteLeadDto) {
    return this.leads.forwardNexoquoteLead(dto);
  }
}
