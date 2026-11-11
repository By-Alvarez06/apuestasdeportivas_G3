import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return health check response', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('api');
    expect(result.version).toBe('0.1.0');
    expect(result.timestamp).toBeDefined();
    expect(typeof result.uptime).toBe('number');
  });
});
