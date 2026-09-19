import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // UN seul proxy devant nous (nginx, sur la même machine) : `true` ferait lire l'entrée la plus à GAUCHE de
  // X-Forwarded-For, c'est-à-dire celle que l'appelant écrit lui-même — et l'étranglement des routes, y compris
  // celle qui détruit des données, deviendrait décoratif (il suffit de changer l'en-tête à chaque requête).
  // Avec 1, Express saute exactement un intermédiaire et prend l'adresse que nginx a posée.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.useGlobalFilters(new GlobalExceptionFilter(), new PrismaExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
  app.enableCors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Tracker API running on http://localhost:${port}`);
}

bootstrap();
