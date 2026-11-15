import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUES } from '../queues/queue-names';
import type { FraudCheck } from './fraud-checks';
import { FraudService } from './fraud.service';

/** Worker de la cola fraud-checks: revisiones tras apostar, canjear o crear una deuda. */
@Processor(QUEUES.FRAUD_CHECKS, { concurrency: 1 })
export class FraudProcessor extends WorkerHost {
  constructor(private readonly fraud: FraudService) {
    super();
  }

  process(job: Job<FraudCheck>): Promise<void> {
    return this.fraud.run(job.data);
  }
}
