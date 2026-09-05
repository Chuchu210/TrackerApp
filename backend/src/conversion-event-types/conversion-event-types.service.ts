import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_CONVERSION_EVENT_TYPES } from './conversion-event-types.seed';
import { CreateConversionEventTypeDto, UpdateConversionEventTypeDto } from './dto/conversion-event-type.dto';
import { normalizeEventType } from '../common/utils/normalize-event-type';
import { excludeTestRows, type TestModeFilter } from '../shared/tracking/test-mode';

const NO_CONVERSION_SLUG = '__no_conversion_slugs__';

@Injectable()
export class ConversionEventTypesService implements OnModuleInit {
  private conversionSlugCache: { slugs: string[]; at: number } | null = null;
  private readonly cacheTtlMs = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedDefaults();
  }

  private invalidateCache() {
    this.conversionSlugCache = null;
  }

  async seedDefaults() {
    for (const row of DEFAULT_CONVERSION_EVENT_TYPES) {
      await this.prisma.conversionEventType.upsert({
        where: { slug: row.slug },
        create: { ...row, isSystem: true },
        update: {
          displayLabel: row.displayLabel,
          sortOrder: row.sortOrder,
          countsAsConversion: row.countsAsConversion,
        },
      });
    }
    this.invalidateCache();
  }

  findAll(includeInactive = false) {
    return this.prisma.conversionEventType.findMany({
      where: includeInactive ? undefined : { active: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findOne(id: string) {
    const row = await this.prisma.conversionEventType.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Conversion event type not found');
    return row;
  }

  /** Slugs that increment the global Conversions / CV / eCPC metrics. */
  async getConversionCountSlugs(): Promise<string[]> {
    if (
      this.conversionSlugCache &&
      Date.now() - this.conversionSlugCache.at < this.cacheTtlMs
    ) {
      return this.conversionSlugCache.slugs;
    }
    const rows = await this.prisma.conversionEventType.findMany({
      where: { countsAsConversion: true, active: true },
      select: { slug: true },
    });
    const slugs = rows.map((r) => r.slug);
    this.conversionSlugCache = { slugs, at: Date.now() };
    return slugs;
  }

  /**
   * Every "how many conversions" query in the app goes through here, which
   * makes it the right place to default test rows out: a caller that says
   * nothing gets real conversions only, and one that means to see test data
   * passes `includeTest` (or sets `isTest` in `where`, which wins).
   */
  async applyConversionCountFilter(
    where: Prisma.ConversionWhereInput = {},
    options: TestModeFilter = {},
  ): Promise<Prisma.ConversionWhereInput> {
    const slugs = await this.getConversionCountSlugs();
    return {
      ...excludeTestRows(options),
      ...where,
      eventType: slugs.length > 0 ? { in: slugs } : { in: [NO_CONVERSION_SLUG] },
    };
  }

  isConversionCounted(eventType: string, slugs: Set<string>): boolean {
    return slugs.has(normalizeEventType(eventType));
  }

  create(dto: CreateConversionEventTypeDto) {
    const slug = normalizeEventType(dto.slug || dto.displayLabel);
    this.invalidateCache();
    return this.prisma.conversionEventType.create({
      data: {
        slug,
        displayLabel: dto.displayLabel,
        sortOrder: dto.sortOrder ?? 500,
        active: dto.active ?? true,
        countsAsConversion: dto.countsAsConversion ?? false,
      },
    });
  }

  async update(id: string, dto: UpdateConversionEventTypeDto) {
    await this.findOne(id);
    this.invalidateCache();
    return this.prisma.conversionEventType.update({
      where: { id },
      data: {
        ...(dto.displayLabel !== undefined ? { displayLabel: dto.displayLabel } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.countsAsConversion !== undefined
          ? { countsAsConversion: dto.countsAsConversion }
          : {}),
      },
    });
  }

  async remove(id: string) {
    const row = await this.findOne(id);
    this.invalidateCache();
    if (row.isSystem) {
      return this.prisma.conversionEventType.update({
        where: { id },
        data: { active: false },
      });
    }
    await this.prisma.conversionEventType.delete({ where: { id } });
    return { deleted: true, id };
  }
}
