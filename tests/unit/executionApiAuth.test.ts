import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { createExecutionRoutes } from '../../src/infrastructure/http/execution-routes';

const itemId = new ObjectId().toString();
const part = { id: itemId, nome: 'Filtro' }, service = { id: itemId, nome: 'Troca' };
const controllers = {
    peca: { getPecaById: jest.fn().mockResolvedValue(part) },
    servico: { getServicoById: jest.fn().mockResolvedValue(service) },
} as unknown as Parameters<typeof createExecutionRoutes>[0];
const app = express();
app.use('/api', createExecutionRoutes(controllers));
const originalMode = process.env.AUTH_MODE, originalKey = process.env.INTERNAL_API_KEY;
afterAll(() => {
    if (originalMode === undefined) delete process.env.AUTH_MODE; else process.env.AUTH_MODE = originalMode;
    if (originalKey === undefined) delete process.env.INTERNAL_API_KEY; else process.env.INTERNAL_API_KEY = originalKey;
});

describe.each(['local', 'gateway'])('trusted service catalog lookups in %s auth mode', mode => {
    beforeEach(() => { process.env.AUTH_MODE = mode; process.env.INTERNAL_API_KEY = 'execution-internal-key'; });
    test.each(['pecas', 'servicos'])('accepts the internal key alone for /api/%s/:id', async resource => {
        const response = await request(app).get(`/api/${resource}/${itemId}`)
            .set('x-internal-api-key', 'execution-internal-key').expect(200);
        expect(response.body).toEqual(resource === 'pecas' ? part : service);
    });
    test.each(['pecas', 'servicos'])('rejects a missing or incorrect key for /api/%s/:id', async resource => {
        await request(app).get(`/api/${resource}/${itemId}`).expect(401);
        await request(app).get(`/api/${resource}/${itemId}`).set('x-internal-api-key', 'wrong-key').expect(401);
    });
});
