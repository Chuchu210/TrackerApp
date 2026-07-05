import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('returns service status with ok=true', () => {
      const status = appController.root();
      expect(status.ok).toBe(true);
      expect(status.service).toBe('tracker-api');
    });
  });

  describe('health', () => {
    it('returns the same status payload', () => {
      expect(appController.health()).toEqual(appController.root());
    });
  });
});
