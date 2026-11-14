import { MongoClient,ObjectId } from 'mongodb';
import { ExecucaoServicoMongoGateway } from '../../src/Adapters/gateways/execucao-servico.mongo.gateway';
import { ExecucaoServico } from '../../src/enterprise/entities/execucao-servico.entity';
import { ExecutionLifecycleConflict } from '../../src/enterprise/entities/execution-completion-event';
const integration=process.env.TEST_EXECUTION_MONGO_URL?describe:describe.skip;
integration('transactional execution outbox',()=>{
 const client=new MongoClient(process.env.TEST_EXECUTION_MONGO_URL??'mongodb://127.0.0.1:27018/?directConnection=true');
 const db=client.db(`messaging_outbox_${process.pid}_${Date.now()}`);const gateway=new ExecucaoServicoMongoGateway(db,true);
 beforeAll(async()=>{await client.connect();await db.collection('ExecucoesServico').createIndex({ordemServicoId:1,servicoId:1},{unique:true});});
 afterAll(async()=>{await db.dropDatabase();await client.close();});
 async function started(order:string,count:number){
  await gateway.saveMany(Array.from({length:count},()=>ExecucaoServico.create(order,new ObjectId().toString())));
  const executions=await gateway.findByOrdemServicoId(order);
  for(const item of executions){item.iniciar();await gateway.update(item.id!,item);}return executions;
 }
 test('last finish creates exactly one event and repeated scheduling cannot reopen the batch',async()=>{
  const order=new ObjectId().toString();const executions=await started(order,2);
  executions[0].finalizar();await gateway.update(executions[0].id!,executions[0]);expect(await db.collection('ExecutionOutbox').countDocuments()).toBe(0);
  executions[1].finalizar();await gateway.update(executions[1].id!,executions[1]);await gateway.ensureCompletionEnqueued(order);
  const rows=await db.collection('ExecutionOutbox').find().toArray();expect(rows).toHaveLength(1);expect(rows[0].event.data.executionIds).toHaveLength(2);
  await expect(gateway.saveMany([ExecucaoServico.create(order,new ObjectId().toString())])).rejects.toBeInstanceOf(ExecutionLifecycleConflict);
 });
 test('failed outbox persistence rolls back the execution finish',async()=>{
  const order=new ObjectId().toString();const [execution]=await started(order,1);
  await db.command({collMod:'ExecutionOutbox',validator:{mustExist:{$exists:true}}});
  execution.finalizar();await expect(gateway.update(execution.id!,execution)).rejects.toThrow();
  expect((await gateway.findById(execution.id!))?.status.value).toBe('EM EXECUCAO');
  await db.command({collMod:'ExecutionOutbox',validator:{}});
 });
});
