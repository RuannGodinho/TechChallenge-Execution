import request from 'supertest';
import { Db, ObjectId } from 'mongodb';
import { createExecutionApp } from '../../src/main/server';

const part = new ObjectId(), service = new ObjectId(), order = new ObjectId(), execution = new ObjectId();
const headers = { 'x-internal-api-key': 'execution-http-test' };
const originalEnv = { ...process.env };
const originalFetch = global.fetch;
function database() {
    function collection(initial: Record<string, unknown>[]) {
        let rows = initial;
        return {
            createIndex: jest.fn(), find: jest.fn(() => ({ toArray: async () => rows })),
            findOne: jest.fn(async (filter: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> => {
                if (filter['movimentos.key']) {
                    const movements = rows[0]?.movimentos as Array<Record<string, unknown>> | undefined;
                    const entry = movements?.find(item => item.key === filter['movimentos.key']);
                    return entry ? { ...rows[0], movimentos: [entry] } : null;
                }
                return rows[0] ?? null;
            }),
            insertOne: jest.fn(async () => ({ insertedId: initial[0]?._id ?? part })),
            findOneAndUpdate: jest.fn(async (_filter: unknown, update: { $set: object }) => {
                if (!rows[0]) return null;
                rows[0] = { ...rows[0], ...update.$set }; return rows[0];
            }),
            updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
            bulkWrite: jest.fn(), deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
        };
    }
    const collections = {
        Pecas: collection([{ _id: part, nome: 'Filtro', descricao: 'Óleo', preco: 30, tipo: 'PECA' }]),
        Servicos: collection([{ _id: service, nome: 'Troca', descricao: 'Óleo', preco: 100 }]),
        Estoque: collection([{ pecaId: part, quantidade: 10, movimentos: [
            { key: 'received', type: 'RECEIVE', quantity: 10, at: new Date() },
            { key: 'consumed', type: 'CONSUME', quantity: 2, at: new Date() },
        ] }]),
        MovimentacoesEstoque: collection([{ _id: new ObjectId(), pecaId: part, tipo: 'ENTRADA', quantidade: 3, origem: 'compra', data: new Date() }]),
        ExecucoesServico: collection([{ _id: execution, ordemServicoId: order, servicoId: service, status: 'PENDENTE', criadoEm: new Date() }]),
        PreparacoesExecucao: collection([]),
    };
    const command = jest.fn().mockResolvedValue({ ok: 1 });
    const db = { collection: (name: keyof typeof collections) => collections[name], command } as unknown as Db;
    return { db, command, ...collections };
}
beforeEach(() => {
    process.env.INTERNAL_API_KEY = 'execution-http-test';
    process.env.EXECUTION_COMPLETION_TRANSPORT = 'http';
    process.env.SERVICE_ORDERS_URL = 'http://orders.test';
    process.env.SERVICE_ORDERS_INTERNAL_API_KEY = 'orders-test';
    let status = 'EM EXECUCAO';
    global.fetch = jest.fn(async (_url, options) => {
        if (options?.method === 'PATCH') status = 'FINALIZADA';
        return new Response(JSON.stringify({ id: order.toString(), status }));
    });
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { process.env = { ...originalEnv }; global.fetch = originalFetch; jest.restoreAllMocks(); });

test('requires internal credentials and exposes database readiness independently of liveness', async () => {
    const c = database(), app = await createExecutionApp(c.db);
    await request(app).get('/health').expect(200, { status: 'ok' });
    await request(app).get('/ready').expect(200);
    c.command.mockRejectedValue(new Error('database offline'));
    await request(app).get('/ready').expect(503);
    for (const key of [undefined, 'bad', 'execution-http-tesX']) {
        const call = request(app).get(`/internal/parts/${part}`);
        if (key) call.set('x-internal-api-key', key);
        await call.expect(401);
    }
    delete process.env.INTERNAL_API_KEY;
    await expect(createExecutionApp(c.db)).rejects.toThrow('INTERNAL_API_KEY is required');
});
test.each([['pecas', 'Pecas', part], ['servicos', 'Servicos', service]] as const)(
    'preserves catalog CRUD, presentation and missing-item responses for %s', async (path, name, id) => {
        const c = database(), app = await createExecutionApp(c.db);
        const base = `/api/${path}`;
        const listed = await request(app).get(base).set(headers).expect(200);
        expect(listed.body).toHaveLength(1); expect(listed.body[0].id).toBe(id.toString());
        await request(app).get(`${base}/${id}`).set(headers).expect(200);
        await request(app).post(base).set(headers).send({ nome: 'Novo', descricao: 'Item', preco: 35, tipo: 'PECA' }).expect(201);
        const updated = await request(app).put(`${base}/${id}`).set(headers).send({ preco: 40 }).expect(200);
        expect(updated.body.preco).toBe(40);
        await request(app).delete(`${base}/${id}`).set(headers).expect(204);
        c[name].findOne.mockResolvedValue(null);
        await request(app).get(`${base}/${id}`).set(headers).expect(404);
        await request(app).put(`${base}/${id}`).set(headers).send({ preco: 40 }).expect(404);
    });
test('presents execution start, finish, timestamps and average duration through the actual controllers', async () => {
    const c = database(), app = await createExecutionApp(c.db);
    const pending = await request(app).get(`/api/execucoes-servico/${order}`).set(headers).expect(200);
    expect(pending.body[0].iniciadoEm).toBeUndefined();
    const started = await request(app).patch(`/api/execucoes-servico/${execution}/iniciar`).set(headers).expect(200);
    expect(started.body.status).toBe('EM EXECUCAO'); expect(started.body.iniciadoEm).toBeDefined();
    const finished = await request(app).patch(`/api/execucoes-servico/${execution}/finalizar`).set(headers).expect(200);
    expect(finished.body.status).toBe('FINALIZADO'); expect(finished.body.finalizadoEm).toBeDefined();
    const metrics = await request(app).get('/api/metricas/tempo-medio-servicos').set(headers).expect(200);
    expect(metrics.body.totalServicosFinalizados).toBe(1);
    expect(global.fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ method: 'PATCH' }));
});
test('reads embedded and legacy inventory and records atomic movements', async () => {
    const c = database(), app = await createExecutionApp(c.db);
    await request(app).get('/api/estoque').set(headers).expect(200, [{ pecaId: part.toString(), quantidade: 10 }]);
    await request(app).get(`/api/estoque/${part}`).set(headers).expect(200);
    const movements = await request(app).get('/api/estoque/movimentacoes').set(headers).expect(200);
    expect(movements.body.map((m: { tipo: string }) => m.tipo)).toEqual(['ENTRADA', 'ENTRADA', 'SAIDA']);
    await request(app).post('/api/estoque/movimentacoes').set(headers).set('idempotency-key', 'receipt-1')
        .send({ pecaId: part.toString(), tipo: 'ENTRADA', quantidade: 3, origem: 'compra' }).expect(201);
    expect(c.Estoque.updateOne).toHaveBeenCalledWith(expect.objectContaining({ pecaId: part }),
        expect.objectContaining({ $inc: { quantidade: 3 } }), { upsert: true });
});
test('keeps internal catalog lookup, creation and unavailable responses compatible', async () => {
    const c = database(), app = await createExecutionApp(c.db);
    for (const [path, name, id] of [['parts', 'Pecas', part], ['services', 'Servicos', service]] as const) {
        await request(app).get(`/internal/${path}/${id}`).set(headers).expect(200);
        await request(app).post(`/internal/${path}`).set(headers).send({ nome: 'Novo', descricao: 'Item', preco: 30, tipo: 'PECA' }).expect(201);
        await request(app).post(`/internal/${path}`).set(headers).send({}).expect(400);
        c[name].findOne.mockResolvedValue(null);
        await request(app).get(`/internal/${path}/${id}`).set(headers).expect(404);
        c[name].findOne.mockRejectedValue(new Error('offline'));
        await request(app).get(`/internal/${path}/${id}`).set(headers).expect(503);
    }
});
test('validates and applies internal inventory commands and handles storage failures', async () => {
    const c = database(), app = await createExecutionApp(c.db);
    const body = { pecaId: part.toString(), quantidade: 2, ordemServicoId: order.toString(), operationId: 'receipt' };
    for (const op of ['check', 'consume', 'receive']) await request(app).post(`/internal/inventory/${op}`).set(headers).send(body).expect(204);
    await request(app).post('/internal/inventory/consume').set(headers).send({ ...body, ordemServicoId: 'bad' }).expect(400);
    await request(app).post('/internal/inventory/receive').set(headers).send({ ...body, operationId: '' }).expect(400);
    c.Pecas.findOne.mockResolvedValue(null);
    await request(app).post('/internal/inventory/receive').set(headers).send(body).expect(404);
    c.Estoque.findOne.mockResolvedValue(null);
    await request(app).post('/internal/inventory/check').set(headers).send(body).expect(409);
    c.Estoque.updateOne.mockRejectedValue(new Error('offline'));
    await request(app).post('/internal/inventory/consume').set(headers).send(body).expect(503);
});
test('schedules internal executions and distinguishes invalid input, missing services and persistence failure', async () => {
    const c = database(), app = await createExecutionApp(c.db);
    const body = { ordemServicoId: order.toString(), servicoIds: [service.toString()] };
    await request(app).post('/internal/executions').set(headers).send(body).expect(204);
    await request(app).post('/internal/executions').set(headers).send({ ...body, servicoIds: ['bad'] }).expect(400);
    c.ExecucoesServico.bulkWrite.mockRejectedValue(new Error('offline'));
    await request(app).post('/internal/executions').set(headers).send(body).expect(503);
    c.Servicos.findOne.mockResolvedValue(null);
    await request(app).post('/internal/executions').set(headers).send(body).expect(404);
});
