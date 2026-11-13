import request from 'supertest';
import jwt from 'jsonwebtoken';
import { MongoClient, ObjectId } from 'mongodb';
import { createExecutionApp } from '../../src/main/server';

const integration = process.env.TEST_EXECUTION_MONGO_URL ? describe : describe.skip;
integration('original Execution HTTP contracts with MongoDB', () => {
    const client = new MongoClient(process.env.TEST_EXECUTION_MONGO_URL ?? 'mongodb://localhost:27018');
    const db = client.db(`endpoint_migration_${process.pid}_${Date.now()}`);
    let app: Awaited<ReturnType<typeof createExecutionApp>>;
    const headers = { 'x-internal-api-key': 'execution-test' };
    let partId: string;
    let serviceId: string;
    const orderId = new ObjectId().toString();
    let orderStatus = 'RECEBIDA';
    let failCompletion = false;
    const originalFetch = global.fetch;
    beforeAll(async () => {
        process.env.INTERNAL_API_KEY = 'execution-test';
        process.env.SERVICE_ORDERS_URL = 'http://orders.test';
        process.env.SERVICE_ORDERS_INTERNAL_API_KEY = 'orders-test';
        await client.connect(); app = await createExecutionApp(db);
        global.fetch = jest.fn(async (_url, options) => {
            expect((options?.headers as Record<string,string>)['x-internal-api-key']).toBe('orders-test');
            if (options?.method === 'PATCH') {
                if (failCompletion) return new Response('{}', { status: 502 });
                orderStatus = 'FINALIZADA';
            }
            return new Response(JSON.stringify({ id: orderId, cpfCnpj: '11144477735', veiculoId: new ObjectId().toString(), status: orderStatus, dataAbertura: new Date().toISOString(), pecas: [], servicos: [serviceId] }), { status: 200 });
        });
    });
    afterAll(async () => { global.fetch = originalFetch; await db.dropDatabase(); await client.close(); });
    test('preserves authentication and original catalog CRUD paths', async () => {
        await request(app).get('/api/pecas').expect(401);
        const token = jwt.sign({ cpf: '11144477735' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
        await request(app).get('/api/pecas').set('Authorization', `Bearer ${token}`).expect(200, []);
        await request(app).get('/api/pecas').set('Authorization', 'Bearer invalid').expect(401);
        const part = await request(app).post('/api/pecas').set(headers).send({ nome: 'Filtro', descricao: 'Filtro de oleo', tipo: 'INSUMO', preco: 30 });
        expect(part.status).toBe(201); partId = part.body.id;
        const service = await request(app).post('/api/servicos').set(headers).send({ nome: 'Troca de oleo', descricao: 'Substituicao', preco: 150 });
        expect(service.status).toBe(201); serviceId = service.body.id;
        for (const [path,id] of [['pecas',partId],['servicos',serviceId]]) {
            const list = await request(app).get(`/api/${path}`).set(headers).expect(200); expect(list.body).toHaveLength(1);
            await request(app).get(`/api/${path}/${id}`).set(headers).expect(200);
            const updated = await request(app).put(`/api/${path}/${id}`).set(headers).send({ preco: 40 }).expect(200); expect(updated.body.preco).toBe(40);
            await request(app).get(`/api/${path}/invalid`).set(headers).expect(400);
        }
        await request(app).get(`/internal/parts/${partId}`).set(headers).expect(200);
    });
    test('records receipt, adjustment, history and concurrent stock consumption atomically', async () => {
        const movement = { pecaId: partId, quantidade: 10, tipo: 'ENTRADA', origem: 'compra' };
        await request(app).post('/api/estoque/movimentacoes').set(headers).set('idempotency-key','receipt-1').send(movement).expect(201);
        await request(app).post('/api/estoque/movimentacoes').set(headers).set('idempotency-key','receipt-1').send(movement).expect(201);
        await request(app).post('/api/estoque/movimentacoes').set(headers).set('idempotency-key','receipt-1').send({ ...movement, quantidade: 11 }).expect(409);
        const responses = await Promise.all([1,2].map(n => request(app).post('/api/estoque/movimentacoes').set(headers).set('idempotency-key',`consume-${n}`).send({ ...movement, quantidade: 7, tipo: 'SAIDA', origem: 'ajuste' })));
        expect(responses.map(r => r.status).sort()).toEqual([201,409]);
        const stock = await request(app).get(`/api/estoque/${partId}`).set(headers).expect(200); expect(stock.body.quantidade).toBe(3);
        const stocks = await request(app).get('/api/estoque').set(headers).expect(200); expect(stocks.body).toHaveLength(1);
        const history = await request(app).get('/api/estoque/movimentacoes').set(headers).expect(200); expect(history.body).toHaveLength(2);
        expect(history.body.some((m: any) => m.origem === 'ajuste')).toBe(true);
    });
    test('lists, starts and finishes executions, retries failed completion and reports metrics', async () => {
        await request(app).post('/internal/executions').set(headers).send({ ordemServicoId: orderId, servicoIds: [serviceId] }).expect(204);
        const list = await request(app).get(`/api/execucoes-servico/${orderId}`).set(headers).expect(200);
        const id = list.body[0].id;
        await request(app).patch(`/api/execucoes-servico/${id}/iniciar`).set(headers).expect(400);
        orderStatus = 'EM EXECUCAO';
        await request(app).patch(`/api/execucoes-servico/${id}/iniciar`).set(headers).expect(200);
        failCompletion = true;
        await request(app).patch(`/api/execucoes-servico/${id}/finalizar`).set(headers).expect(502);
        const first = await db.collection('ExecucoesServico').findOne({ _id: new ObjectId(id) });
        failCompletion = false;
        const finished = await request(app).patch(`/api/execucoes-servico/${id}/finalizar`).set(headers).expect(200);
        expect(finished.body.finalizadoEm).toBe(first!.finalizadoEm.toISOString());
        expect(orderStatus).toBe('FINALIZADA');
        const metrics = await request(app).get('/api/metricas/tempo-medio-servicos').set(headers).expect(200); expect(metrics.body.totalServicosFinalizados).toBe(1);
    });
    test('deletes catalog items through their original URLs', async () => {
        await request(app).delete(`/api/pecas/${partId}`).set(headers).expect(204);
        await request(app).get(`/api/pecas/${partId}`).set(headers).expect(404);
        await request(app).delete(`/api/servicos/${serviceId}`).set(headers).expect(204);
        await request(app).get(`/api/servicos/${serviceId}`).set(headers).expect(404);
    });
});
