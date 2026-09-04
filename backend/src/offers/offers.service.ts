import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOfferDto, UpdateOfferDto } from './dto/offer.dto';

const OFFER_COUNTRIES = ['FR', 'BE', 'CH', 'CA', 'US', 'GB', 'DE', 'ES', 'IT'];
const OFFER_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD'];

@Injectable()
export class OffersService {
  constructor(private readonly prisma: PrismaService) {}

  getMeta() {
    return { countries: OFFER_COUNTRIES, currencies: OFFER_CURRENCIES };
  }

  async list(filters: {
    q?: string;
    active?: boolean;
    limit?: number;
    offset?: number;
  }) {
    const where: Prisma.OfferWhereInput = {};
    if (filters.active !== undefined) where.active = filters.active;
    if (filters.q) {
      where.OR = [
        { name: { contains: filters.q, mode: 'insensitive' } },
        { slug: { contains: filters.q, mode: 'insensitive' } },
        { url: { contains: filters.q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.offer.findMany({
        where,
        include: {
          affiliateNetwork: true,
          _count: { select: { offerClicks: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: filters.limit || 50,
        skip: filters.offset || 0,
      }),
      this.prisma.offer.count({ where }),
    ]);

    return { items, total };
  }

  async findOne(id: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id },
      include: {
        affiliateNetwork: true,
        _count: { select: { offerClicks: true } },
      },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    return offer;
  }

  async findBySlug(slug: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { slug },
      include: { affiliateNetwork: true },
    });
    if (!offer) throw new NotFoundException(`Offer "${slug}" not found`);
    return offer;
  }

  async create(dto: CreateOfferDto) {
    await this.assertSlugFree(dto.slug);
    if (dto.affiliateNetworkId) {
      await this.assertNetworkExists(dto.affiliateNetworkId);
    }

    return this.prisma.offer.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        url: dto.url,
        payout: dto.payout ?? 0,
        currency: dto.currency || 'EUR',
        country: dto.country || null,
        active: dto.active ?? true,
        affiliateNetworkId: dto.affiliateNetworkId || null,
      },
      include: { affiliateNetwork: true },
    });
  }

  async update(id: string, dto: UpdateOfferDto) {
    const existing = await this.findOne(id);
    if (dto.slug && dto.slug !== existing.slug) {
      await this.assertSlugFree(dto.slug);
    }
    if (dto.affiliateNetworkId) {
      await this.assertNetworkExists(dto.affiliateNetworkId);
    }

    return this.prisma.offer.update({
      where: { id },
      data: dto,
      include: { affiliateNetwork: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.offer.delete({ where: { id } });
    return { deleted: true, id };
  }

  private async assertSlugFree(slug: string) {
    const clash = await this.prisma.offer.findUnique({ where: { slug } });
    if (clash) throw new BadRequestException(`Slug "${slug}" already exists`);
  }

  private async assertNetworkExists(id: string) {
    const network = await this.prisma.affiliateNetwork.findUnique({
      where: { id },
    });
    if (!network) throw new NotFoundException('Affiliate network not found');
  }
}
