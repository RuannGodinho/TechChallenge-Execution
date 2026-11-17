import { ProcessarComandoSagaUseCase } from '../../application/usecases/participante-saga.usecase';
import { MongoClient } from 'mongodb';
import { PreparacaoExecucaoMongoGateway } from '../../Adapters/gateways/preparacao-execucao.mongo.gateway';
import { SagaMongoOutbox } from '../../Adapters/gateways/saga-outbox.mongo.gateway';
import { parseSaga } from './saga';
import { runConsumer, runOutboxPublisher, workerControl } from './rabbitmq';
async function main() { const url = process.env.RABBITMQ_URL, uri = process.env.MONGODB_URI; if (!url || !uri)
    throw Error('RabbitMQ and MongoDB required'); const client = new MongoClient(uri); await client.connect(); const db = client.db(); const control = workerControl(); try {
    const gateway = new PreparacaoExecucaoMongoGateway(db);
    await Promise.all([runConsumer(url, 'execution.saga.commands', parseSaga, m => new ProcessarComandoSagaUseCase({ execute: message => gateway.execute(message as typeof m) }).execute(m), control), runOutboxPublisher(url, 'saga.results', new SagaMongoOutbox(db), control)]);
}
finally {
    await client.close();
} }
if (require.main === module)
    main().catch(e => { console.error(e.message); process.exitCode = 1; });
