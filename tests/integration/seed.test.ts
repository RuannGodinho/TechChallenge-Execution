import { MongoClient, ObjectId } from 'mongodb';
const { seedDatabase } = require('../../src/mongo-init/seed.js');
const integration = process.env.TEST_EXECUTION_MONGO_URL ? describe : describe.skip;
integration('Execution development seed', () => {
  const client = new MongoClient(process.env.TEST_EXECUTION_MONGO_URL ?? 'mongodb://127.0.0.1:27018/?directConnection=true');
  const db = client.db(`seed_${process.pid}_${Date.now()}`);
  beforeAll(async () => { await client.connect(); });
  afterAll(async () => { await db.dropDatabase(); await client.close(); });
  test('repeated seeds preserve edited catalog, consumed stock and movement history', async () => {
    await seedDatabase(db);
    const pecaId = new ObjectId('00000000000000000000a001');
    await db.collection('Pecas').updateOne({ _id: pecaId }, { $set: { preco: 49 } });
    await db.collection('Estoque').updateOne({ pecaId }, {
      $inc: { quantidade: -4 },
      $push: { movimentos: { key: 'test:consumption', type: 'CONSUME', quantity: 4, at: new Date() } },
    } as never);
    await Promise.all([seedDatabase(db), seedDatabase(db)]);
    expect(await db.collection('Pecas').countDocuments()).toBe(3);
    expect(await db.collection('Servicos').countDocuments()).toBe(3);
    expect(await db.collection('Estoque').countDocuments()).toBe(3);
    expect((await db.collection('Pecas').findOne({ _id: pecaId }))?.preco).toBe(49);
    const stock = await db.collection('Estoque').findOne({ pecaId });
    expect(stock?.quantidade).toBe(36);
    expect(stock?.movimentos).toHaveLength(2);
    expect(await db.collection('ExecutionOutbox').countDocuments()).toBe(0);
  });
});
