import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PostbacksService } from './postbacks.service';
import { MediagoStrategy } from './strategies/mediago.strategy';
import { FacebookStrategy } from './strategies/facebook.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { OutbrainStrategy } from './strategies/outbrain.strategy';
import { OpenAiStrategy } from './strategies/openai.strategy';

@Module({
  imports: [HttpModule],
  providers: [
    PostbacksService,
    MediagoStrategy,
    FacebookStrategy,
    GoogleStrategy,
    OutbrainStrategy,
    OpenAiStrategy,
  ],
  exports: [PostbacksService],
})
export class PostbacksModule {}
