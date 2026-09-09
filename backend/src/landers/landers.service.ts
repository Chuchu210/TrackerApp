import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainStatus, LanderStatus, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { DomainsService } from '../domains/domains.service';
import { TrackerScriptService } from '../tracker-script/tracker-script.service';
import { CreateLanderDto } from './dto/create-lander.dto';
import { UpdateLanderDto } from './dto/update-lander.dto';
import { buildTrackerScriptTag, injectTrackerIntoHtml } from './inject-tracker';
import {
  slugify,
  ensureDir,
  emptyDir,
  copyDirRecursive,
  countFiles,
  extractZipToDir,
  writeUploadedFiles,
  createZipFromDir,
  buildDeployScript,
} from './lander-storage';

@Injectable()
export class LandersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly domains: DomainsService,
    private readonly trackerScript: TrackerScriptService,
  ) {}

  private get storageRoot(): string {
    return (
      this.config.get<string>('LANDERS_STORAGE_ROOT') ||
      path.join(process.cwd(), 'storage', 'landers')
    );
  }

  private landerDir(id: string) {
    return path.join(this.storageRoot, id);
  }

  private rawDir(id: string) {
    return path.join(this.landerDir(id), 'raw');
  }

  private processedDir(id: string) {
    return path.join(this.landerDir(id), 'processed');
  }

  private includeCampaign() {
    return {
      campaign: {
        select: {
          id: true,
          name: true,
          slug: true,
          externalId: true,
          trackingMode: true,
          destinationUrl: true,
          domain: { select: { hostname: true, rootDomain: true, status: true } },
        },
      },
    };
  }

  private enrich<T extends { id: string; storagePath: string; rootDomain?: string | null }>(
    lander: T,
  ) {
    const fileCount = countFiles(this.rawDir(lander.id));
    const processedCount = countFiles(this.processedDir(lander.id));
    const deployCommand = `REMOTE=root@your-server REMOTE_PATH=/var/www/${lander.rootDomain || 'domain'} bash deploy.sh`;

    return {
      ...lander,
      fileCount,
      processedCount,
      hasFiles: fileCount > 0,
      deployCommand,
    };
  }

  async findAll() {
    const rows = await this.prisma.lander.findMany({
      orderBy: { updatedAt: 'desc' },
      include: this.includeCampaign(),
    });
    return rows.map((r) => this.enrich(r));
  }

  async findOne(id: string) {
    const lander = await this.prisma.lander.findUnique({
      where: { id },
      include: this.includeCampaign(),
    });
    if (!lander) throw new NotFoundException('Lander not found');
    return this.enrich(lander);
  }

  async suggest(campaignId?: string, name?: string) {
    let campaign = null;
    if (campaignId) {
      campaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
        include: {
          domain: { select: { rootDomain: true, hostname: true, status: true } },
        },
      });
      if (!campaign) throw new NotFoundException('Campaign not found');
    }

    const verified = await this.prisma.trackingDomain.findMany({
      where: { status: DomainStatus.verified },
      orderBy: { createdAt: 'asc' },
    });

    const rootDomain =
      campaign?.domain?.status === DomainStatus.verified
        ? campaign.domain.rootDomain
        : verified[0]?.rootDomain || '';

    const baseSlug = slugify(name || campaign?.slug || 'lander');
    const slug = await this.uniqueSlug(baseSlug);

    const publicUrl = rootDomain ? `https://${rootDomain}/` : '';

    let trackerSnippet = '';
    if (campaign) {
      const trackerBase = this.domains.getTrackerBaseUrl(campaign.domain);
      trackerSnippet =
        buildTrackerScriptTag(
          this.trackerScript,
          campaign,
          trackerBase,
          true,
          null,
        ) || '';
    }

    return {
      slug,
      rootDomain,
      publicUrl,
      trackerSnippet,
      verifiedDomains: verified.map((d) => ({
        id: d.id,
        label: d.label,
        rootDomain: d.rootDomain,
        hostname: d.hostname,
      })),
    };
  }

  async create(dto: CreateLanderDto) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: dto.campaignId },
      include: { domain: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const suggestion = await this.suggest(dto.campaignId, dto.name);
    const slug = dto.slug ? slugify(dto.slug) : suggestion.slug;
    await this.assertUniqueSlug(slug);

    const rootDomain = dto.rootDomain || suggestion.rootDomain || null;
    const publicUrl =
      dto.publicUrl || (rootDomain ? `https://${rootDomain}/` : 'https://example.com/');

    const lander = await this.prisma.lander.create({
      data: {
        name: dto.name,
        slug,
        campaignId: dto.campaignId,
        rootDomain,
        publicUrl,
        storagePath: '',
        entryFile: dto.entryFile || 'index.html',
        injectTracker: dto.injectTracker ?? true,
        trackerAttrs: (dto.trackerAttrs || undefined) as Prisma.InputJsonValue | undefined,
        status: dto.status || LanderStatus.draft,
      },
      include: this.includeCampaign(),
    });

    await this.prisma.lander.update({
      where: { id: lander.id },
      data: { storagePath: lander.id },
    });

    ensureDir(this.rawDir(lander.id));
    ensureDir(this.processedDir(lander.id));

    await this.linkCampaign(lander.id);
    return this.findOne(lander.id);
  }

  async update(id: string, dto: UpdateLanderDto) {
    const existing = await this.findOne(id);

    if (dto.slug && slugify(dto.slug) !== existing.slug) {
      await this.assertUniqueSlug(slugify(dto.slug), id);
    }

    if (dto.campaignId && dto.campaignId !== existing.campaignId) {
      const campaign = await this.prisma.campaign.findUnique({ where: { id: dto.campaignId } });
      if (!campaign) throw new NotFoundException('Campaign not found');
    }

    await this.prisma.lander.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.campaignId !== undefined ? { campaignId: dto.campaignId } : {}),
        ...(dto.slug !== undefined ? { slug: slugify(dto.slug) } : {}),
        ...(dto.rootDomain !== undefined ? { rootDomain: dto.rootDomain || null } : {}),
        ...(dto.publicUrl !== undefined ? { publicUrl: dto.publicUrl } : {}),
        ...(dto.entryFile !== undefined ? { entryFile: dto.entryFile } : {}),
        ...(dto.injectTracker !== undefined ? { injectTracker: dto.injectTracker } : {}),
        ...(dto.trackerAttrs !== undefined
          ? { trackerAttrs: dto.trackerAttrs as Prisma.InputJsonValue }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });

    await this.linkCampaign(id);
    await this.processFiles(id);
    return this.findOne(id);
  }

  async remove(id: string) {
    const lander = await this.findOne(id);
    await this.unlinkCampaign(lander.campaignId, lander.slug);
    await this.prisma.lander.delete({ where: { id } });
    if (fs.existsSync(this.landerDir(id))) {
      fs.rmSync(this.landerDir(id), { recursive: true, force: true });
    }
    return { deleted: true, id };
  }

  async uploadZip(id: string, buffer: Buffer) {
    const lander = await this.findOne(id);
    const maxMb = Number(this.config.get('LANDERS_MAX_UPLOAD_MB') || 50);
    if (buffer.length > maxMb * 1024 * 1024) {
      throw new BadRequestException(`Upload exceeds ${maxMb}MB limit`);
    }

    extractZipToDir(buffer, this.rawDir(id));
    await this.validateEntryFile(id, lander.entryFile);
    await this.processFiles(id);
    await this.prisma.lander.update({
      where: { id },
      data: { status: LanderStatus.ready },
    });
    return this.findOne(id);
  }

  async uploadFiles(id: string, files: { originalname: string; buffer: Buffer }[]) {
    const lander = await this.findOne(id);
    if (!files.length) throw new BadRequestException('No files provided');

    const maxMb = Number(this.config.get('LANDERS_MAX_UPLOAD_MB') || 50);
    const total = files.reduce((s, f) => s + f.buffer.length, 0);
    if (total > maxMb * 1024 * 1024) {
      throw new BadRequestException(`Upload exceeds ${maxMb}MB limit`);
    }

    writeUploadedFiles(files, this.rawDir(id));
    await this.validateEntryFile(id, lander.entryFile);
    await this.processFiles(id);
    await this.prisma.lander.update({
      where: { id },
      data: { status: LanderStatus.ready },
    });
    return this.findOne(id);
  }

  async reprocess(id: string) {
    await this.processFiles(id);
    return this.findOne(id);
  }

  async downloadRawZip(id: string): Promise<Buffer> {
    await this.findOne(id);
    if (!fs.existsSync(this.rawDir(id))) {
      throw new BadRequestException('No files uploaded');
    }
    return createZipFromDir(this.rawDir(id));
  }

  async deployBundle(id: string): Promise<Buffer> {
    const lander = await this.findOne(id);
    if (!lander.hasFiles) {
      throw new BadRequestException('Upload lander files first');
    }

    await this.processFiles(id);
    const bundleDir = path.join(this.landerDir(id), 'bundle');
    emptyDir(bundleDir);
    copyDirRecursive(this.processedDir(id), bundleDir);

    const deployScript = buildDeployScript(lander.rootDomain);
    fs.writeFileSync(path.join(bundleDir, 'deploy.sh'), deployScript, { mode: 0o755 });

    return createZipFromDir(bundleDir);
  }

  private async validateEntryFile(id: string, entryFile: string) {
    const entryPath = path.join(this.rawDir(id), entryFile);
    if (!fs.existsSync(entryPath)) {
      throw new BadRequestException(`Entry file "${entryFile}" not found in upload`);
    }
  }

  private async processFiles(id: string) {
    const lander = await this.prisma.lander.findUnique({
      where: { id },
      include: {
        campaign: {
          include: { domain: true },
        },
      },
    });
    if (!lander) return;

    const raw = this.rawDir(id);
    const processed = this.processedDir(id);
    if (!fs.existsSync(raw)) return;

    emptyDir(processed);
    copyDirRecursive(raw, processed);

    if (!lander.injectTracker) return;

    const entryPath = path.join(processed, lander.entryFile);
    if (!fs.existsSync(entryPath)) return;

    const trackerBase = this.domains.getTrackerBaseUrl(lander.campaign.domain);
    const attrs = lander.trackerAttrs as { noViewContent?: boolean } | null;
    const scriptTag = buildTrackerScriptTag(
      this.trackerScript,
      lander.campaign,
      trackerBase,
      lander.injectTracker,
      attrs,
      { slug: lander.slug, name: lander.name },
    );
    if (!scriptTag) return;

    const html = fs.readFileSync(entryPath, 'utf8');
    const updated = injectTrackerIntoHtml(html, scriptTag);
    fs.writeFileSync(entryPath, updated, 'utf8');
  }

  private async linkCampaign(landerId: string) {
    const lander = await this.prisma.lander.findUnique({
      where: { id: landerId },
      include: { campaign: true },
    });
    if (!lander) return;

    await this.prisma.campaign.update({
      where: { id: lander.campaignId },
      data: {
        destinationUrl: lander.publicUrl,
        landerId: lander.slug,
        landerName: lander.name,
      },
    });
  }

  private async unlinkCampaign(campaignId: string, landerSlug: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (campaign?.landerId === landerSlug) {
      await this.prisma.campaign.update({
        where: { id: campaignId },
        data: { landerId: null, landerName: null },
      });
    }
  }

  private async uniqueSlug(base: string): Promise<string> {
    let slug = slugify(base);
    let n = 0;
    while (await this.prisma.lander.findUnique({ where: { slug } })) {
      n++;
      slug = `${slugify(base)}-${n}`;
    }
    return slug;
  }

  private async assertUniqueSlug(slug: string, excludeId?: string) {
    const existing = await this.prisma.lander.findUnique({ where: { slug } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`Lander slug "${slug}" already exists`);
    }
  }
}
