import * as logger from './logger.js'
import * as processTracer from './processTracer.js'
import * as statCollector from './statCollector.js'

async function run(): Promise<void> {
  logger.info('Initializing ...')
  statCollector.start()
  if (processTracer.isEnabled()) await processTracer.start()
  logger.info('Initialization completed')
}

run().catch(error => logger.warning('Initialization failed', error))
