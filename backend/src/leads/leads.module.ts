import { Module } from '@nestjs/common';
import { ConversionsModule } from '../conversions/conversions.module';
import { IntakeKeyGuard } from './intake-key.guard';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  // Un lead externe entre par la porte des conversions, comme tous les autres : c'est là que vivent le refus de
  // recréer une personne effacée, le dédoublonnage et les postbacks.
  imports: [ConversionsModule],
  controllers: [LeadsController],
  providers: [LeadsService, IntakeKeyGuard],
})
export class LeadsModule {}
