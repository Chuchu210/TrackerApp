import { Module } from '@nestjs/common';
import { AffiliateNetworksService } from './affiliate-networks.service';
import { AffiliateNetworksController } from './affiliate-networks.controller';

@Module({
  controllers: [AffiliateNetworksController],
  providers: [AffiliateNetworksService],
  exports: [AffiliateNetworksService],
})
export class AffiliateNetworksModule {}
