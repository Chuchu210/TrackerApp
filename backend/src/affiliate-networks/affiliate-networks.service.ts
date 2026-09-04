import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAffiliateNetworkDto,
  UpdateAffiliateNetworkDto,
} from './dto/affiliate-network.dto';

@Injectable()
export class AffiliateNetworksService {
  constructor(private readonly prisma: PrismaService) {}

  list(includeInactive = false) {
    return this.prisma.affiliateNetwork.findMany({
      where: includeInactive ? {} : { active: true },
      include: { _count: { select: { offers: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const network = await this.prisma.affiliateNetwork.findUnique({
      where: { id },
      include: {
        offers: {
          select: { id: true, name: true, slug: true, payout: true, active: true },
          orderBy: { name: 'asc' },
        },
      },
    });
    if (!network) throw new NotFoundException('Affiliate network not found');
    return network;
  }

  async create(dto: CreateAffiliateNetworkDto) {
    await this.assertSlugFree(dto.slug);
    return this.prisma.affiliateNetwork.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        clickIdParam: dto.clickIdParam || 'subid',
        clickIdToken: dto.clickIdToken || null,
        payoutToken: dto.payoutToken || null,
        transactionIdToken: dto.transactionIdToken || null,
        eventTypeToken: dto.eventTypeToken || null,
        defaultCurrency: dto.defaultCurrency || 'EUR',
        postbackUrlTemplate: dto.postbackUrlTemplate || null,
        active: dto.active ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateAffiliateNetworkDto) {
    const existing = await this.prisma.affiliateNetwork.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Affiliate network not found');
    if (dto.slug && dto.slug !== existing.slug) {
      await this.assertSlugFree(dto.slug);
    }
    return this.prisma.affiliateNetwork.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const network = await this.prisma.affiliateNetwork.findUnique({
      where: { id },
      include: { _count: { select: { offers: true } } },
    });
    if (!network) throw new NotFoundException('Affiliate network not found');
    // Offers survive on purpose (the FK is ON DELETE SET NULL), but silently
    // orphaning them would hide a mistake — make the caller detach first.
    if (network._count.offers > 0) {
      throw new BadRequestException(
        `Network still has ${network._count.offers} offer(s) attached`,
      );
    }
    await this.prisma.affiliateNetwork.delete({ where: { id } });
    return { deleted: true, id };
  }

  private async assertSlugFree(slug: string) {
    const clash = await this.prisma.affiliateNetwork.findUnique({
      where: { slug },
    });
    if (clash) throw new BadRequestException(`Slug "${slug}" already exists`);
  }
}
