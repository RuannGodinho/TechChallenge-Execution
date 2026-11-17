const { MongoClient, ObjectId } = require('mongodb');

// Development fixtures owned by Execution. IDs are stable across restarts.
const parts = [
  {
    "id": "00000000000000000000a001",
    "nome": "Óleo de motor 5W30",
    "descricao": "Óleo sintético para motor, 1 litro",
    "tipo": "INSUMO",
    "preco": 45,
    "stock": 40
  },
  {
    "id": "00000000000000000000a002",
    "nome": "Filtro de óleo",
    "descricao": "Filtro de óleo do motor",
    "tipo": "PECA",
    "preco": 35,
    "stock": 20
  },
  {
    "id": "00000000000000000000a003",
    "nome": "Pastilhas de freio",
    "descricao": "Jogo de pastilhas de freio dianteiras",
    "tipo": "PECA",
    "preco": 220,
    "stock": 10
  }
];
const services = [
  {
    "id": "00000000000000000000b001",
    "nome": "Troca de óleo",
    "descricao": "Substituição do óleo e filtro do motor",
    "preco": 150
  },
  {
    "id": "00000000000000000000b002",
    "nome": "Troca de pastilhas",
    "descricao": "Substituição das pastilhas de freio dianteiras",
    "preco": 180
  },
  {
    "id": "00000000000000000000b003",
    "nome": "Alinhamento e balanceamento",
    "descricao": "Alinhamento da direção e balanceamento das rodas",
    "preco": 120
  }
];

async function seedDatabase(db) {
  await db.collection('Estoque').createIndex({ pecaId: 1 }, { unique: true });
  const session = db.client.startSession();
  try {
    await session.withTransaction(async () => {
      for (const { id, stock, ...part } of parts) {
        const pecaId = new ObjectId(id);
        await db.collection('Pecas').updateOne(
          { _id: pecaId }, { $setOnInsert: part }, { upsert: true, session },
        );
        await db.collection('Estoque').updateOne(
          { pecaId },
          { $setOnInsert: { quantidade: stock, movimentos: [{ key: `seed:initial:${id}`, type: 'RECEIVE', quantity: stock, at: new Date(), origem: 'compra' }] } },
          { upsert: true, session },
        );
      }
      for (const { id, ...service } of services) {
        await db.collection('Servicos').updateOne(
          { _id: new ObjectId(id) }, { $setOnInsert: service }, { upsert: true, session },
        );
      }
    });
  } finally {
    await session.endSession();
  }
}

async function runSeed() {
  if (process.env.SEED_ENABLED === 'false') return;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  const client = new MongoClient(uri);
  try {
    await client.connect();
    await seedDatabase(client.db());
    console.log('Execution seed complete: parts, services and initial inventory.');
  } finally {
    await client.close();
  }
}

module.exports = { seedDatabase };
if (require.main === module) runSeed().catch(error => { console.error('Execution seed failed:', error.message); process.exitCode = 1; });
