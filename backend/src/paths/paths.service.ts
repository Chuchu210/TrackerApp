import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePathDto,
  UpdatePathDto,
  CreateVariantDto,
  UpdateVariantDto,
} from './dto/path.dto';

@Injectable()
export class PathsService {
  constructor(private readonly prisma: PrismaService) {}

  listForCampaign(campaignId: string) {
    return this.prisma.campaignPath.findMany({
      where: { campaignId },
      include: {
        variants: {
          orderBy: { createdAt: 'asc' },
          include: { offer: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createPath(campaignId: string, dto: CreatePathDto) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('Campaign not found');

    return this.prisma.campaignPath.create({
      data: {
        campaignId,
        name: dto.name ?? 'Path',
        weight: dto.weight ?? 100,
        active: dto.active ?? true,
        conditions: (dto.conditions ?? []) as unknown as Prisma.InputJsonValue,
        destinationUrl: dto.destinationUrl ?? null,
      },
      include: { variants: true },
    });
  }

  async updatePath(id: string, dto: UpdatePathDto) {
    await this.getPathOrThrow(id);
    return this.prisma.campaignPath.update({
      where: { id },
      data: {
        name: dto.name,
        weight: dto.weight,
        active: dto.active,
        conditions:
          dto.conditions !== undefined
            ? (dto.conditions as unknown as Prisma.InputJsonValue)
            : undefined,
        destinationUrl: dto.destinationUrl,
      },
      include: { variants: true },
    });
  }

  async deletePath(id: string) {
    await this.getPathOrThrow(id);
    await this.prisma.campaignPath.delete({ where: { id } });
    return { deleted: true, id };
  }

  async createVariant(pathId: string, dto: CreateVariantDto) {
    await this.getPathOrThrow(pathId);
    return this.prisma.pathVariant.create({
      data: {
        pathId,
        label: dto.label ?? 'Variant',
        kind: dto.kind ?? undefined,
        destinationUrl: dto.destinationUrl,
        offerId: dto.offerId || null,
        weight: dto.weight ?? 100,
        active: dto.active ?? true,
      },
      include: { offer: { select: { id: true, name: true } } },
    });
  }

  async updateVariant(id: string, dto: UpdateVariantDto) {
    const variant = await this.prisma.pathVariant.findUnique({ where: { id } });
    if (!variant) throw new NotFoundException('Variant not found');
    return this.prisma.pathVariant.update({
      where: { id },
      data: {
        label: dto.label,
        kind: dto.kind,
        destinationUrl: dto.destinationUrl,
        offerId: dto.offerId === undefined ? undefined : dto.offerId || null,
        weight: dto.weight,
        active: dto.active,
      },
      include: { offer: { select: { id: true, name: true } } },
    });
  }

  async deleteVariant(id: string) {
    const variant = await this.prisma.pathVariant.findUnique({ where: { id } });
    if (!variant) throw new NotFoundException('Variant not found');
    await this.prisma.pathVariant.delete({ where: { id } });
    return { deleted: true, id };
  }

  private async getPathOrThrow(id: string) {
    const path = await this.prisma.campaignPath.findUnique({ where: { id } });
    if (!path) throw new NotFoundException('Path not found');
    return path;
  }
}
