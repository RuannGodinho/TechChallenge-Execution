import { MongoClient } from 'mongodb';
import { ExecutionOutboxMongoGateway } from '../../Adapters/gateways/execution-outbox.mongo.gateway';
import { runOutboxPublisher, workerControl } from './rabbitmq';
async function main() {
    if (!process.env.MONGODB_URI || !process.env.RABBITMQ_URL) throw new Error('MONGODB_URI and RABBITMQ_URL are required');
    const client=new MongoClient(process.env.MONGODB_URI); await client.connect();
    await client.db().collection('ExecutionOutbox').createIndex({publishedAt:1,nextAttemptAt:1,leaseUntil:1});
    try { await runOutboxPublisher(process.env.RABBITMQ_URL,'execution.events',new ExecutionOutboxMongoGateway(client.db()),workerControl()); }
    finally { await client.close(); }
}
if(require.main===module) void main().catch(error=>{console.error(error.message);process.exitCode=1;});
