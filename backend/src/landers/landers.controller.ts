import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { LandersService } from './landers.service';
import { LanderHealthService } from './lander-health.service';
import { CreateLanderDto } from './dto/create-lander.dto';
import { UpdateLanderDto } from './dto/update-lander.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller('api/landers')
@UseGuards(ApiKeyGuard)
export class LandersController {
  constructor(
    private readonly landers: LandersService,
    private readonly health: LanderHealthService,
  ) {}

  /** Probe every ready lander now instead of waiting for the hourly sweep. */
  @Post('health-check')
  runHealthCheck() {
    return this.health.checkAll();
  }

  @Get()
  findAll() {
    return this.landers.findAll();
  }

  @Get('suggest')
  suggest(@Query('campaignId') campaignId?: string, @Query('name') name?: string) {
    return this.landers.suggest(campaignId, name);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.landers.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateLanderDto) {
    return this.landers.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLanderDto) {
    return this.landers.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.landers.remove(id);
  }

  @Post(':id/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  uploadZip(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer?.length) {
      return this.landers.uploadFiles(id, []);
    }
    const isZip =
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed' ||
      file.originalname.toLowerCase().endsWith('.zip');
    if (isZip) {
      return this.landers.uploadZip(id, file.buffer);
    }
    return this.landers.uploadFiles(id, [
      { originalname: file.originalname, buffer: file.buffer },
    ]);
  }

  @Post(':id/upload-files')
  @UseInterceptors(
    FilesInterceptor('files', 100, {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  uploadFiles(@Param('id') id: string, @UploadedFiles() files: Express.Multer.File[]) {
    const mapped = (files || []).map((f) => ({
      originalname: f.originalname,
      buffer: f.buffer,
    }));
    return this.landers.uploadFiles(id, mapped);
  }

  @Post(':id/reprocess')
  reprocess(@Param('id') id: string) {
    return this.landers.reprocess(id);
  }

  @Get(':id/download')
  async downloadRaw(@Param('id') id: string, @Res() res: Response) {
    const lander = await this.landers.findOne(id);
    const zip = await this.landers.downloadRawZip(id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${lander.slug}-raw.zip"`);
    res.send(zip);
  }

  @Get(':id/deploy-bundle')
  async deployBundle(@Param('id') id: string, @Res() res: Response) {
    const lander = await this.landers.findOne(id);
    const zip = await this.landers.deployBundle(id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${lander.slug}-deploy.zip"`);
    res.send(zip);
  }
}
