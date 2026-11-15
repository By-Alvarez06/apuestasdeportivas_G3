import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QUEUES } from './queue-names';
import { redisConnection } from './redis-connection';

/**
 * Colas persistentes de la spec 4 (constitución V, research R6). Los trabajos fallidos se
 * reintentan con espera exponencial y se conservan para revisión; los completados se recortan.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: redisConnection(config.get<string>('REDIS_URL', 'redis://localhost:6379')),
        prefix: config.get<string>('BULLMQ_PREFIX', 'apuestas'),
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 1000,
          removeOnFail: false,
        },
      }),
    }),
    BullModule.registerQueue({ name: QUEUES.MATCH_EVENTS }, { name: QUEUES.FRAUD_CHECKS }),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
