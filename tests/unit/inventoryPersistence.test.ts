import { Db, ObjectId } from 'mongodb';
import { EstoqueMongoGateway } from '../../src/Adapters/gateways/estoque.mongo.gateway';
import { MovimentacaoEstoqueMongoGateway } from '../../src/Adapters/gateways/movimentacao-estoque.mongo.gateway';
import { EstoqueMapper } from '../../src/Adapters/gateways/mappers/estoque.mapper';
import { MovimentacaoEstoqueMapper } from '../../src/Adapters/gateways/mappers/movimentacao-estoque.mapper';
import { EstoqueController } from '../../src/Adapters/controllers/estoque.controller';
import { EstoquePresenter } from '../../src/Adapters/presenters/estoque.presenter';
import { ListarEstoqueUseCase } from '../../src/application/usecases/estoque/listar-estoque.usecase';
import { BuscarEstoquePorPecaIdUseCase } from '../../src/application/usecases/estoque/buscar-estoque-por-peca-id.usecase';
import { ListarMovimentacoesEstoqueUseCase } from '../../src/application/usecases/estoque/listar-movimentacoes-estoque.usecase';
import { RegistrarMovimentacaoEstoqueUseCase } from '../../src/application/usecases/estoque/registrar-movimentacao-estoque.usecase';
import { IPecaGateway } from '../../src/application/ports/peca.gateway.port';
import { MovimentacaoEstoque } from '../../src/enterprise/entities/movimentacao-estoque.entity';

const partId = new ObjectId(), movementId = new ObjectId(), at = new Date('2026-01-01');
const movement = { _id: movementId, pecaId: partId, quantidade: 4, tipo: 'SAIDA', origem: 'ordem', data: at };
function setup(existing = true) {
    const stock = { findOne: jest.fn().mockResolvedValue(existing ? { pecaId: partId, quantidade: 10 } : null),
        find: jest.fn().mockReturnValue({ toArray: async () => [{ pecaId: partId, quantidade: 10 }] }),
        insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }), updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
    const movements = { find: jest.fn().mockReturnValue({ toArray: async () => [movement] }),
        insertOne: jest.fn().mockResolvedValue({ insertedId: movementId }) };
    const db = { collection: (name: string) => name === 'Estoque' ? stock : movements } as unknown as Db;
    const stockGateway = new EstoqueMongoGateway(db), movementGateway = new MovimentacaoEstoqueMongoGateway(db);
    const controller = new EstoqueController(new ListarEstoqueUseCase(stockGateway), new BuscarEstoquePorPecaIdUseCase(stockGateway),
        new RegistrarMovimentacaoEstoqueUseCase(stockGateway, movementGateway, { findById: jest.fn().mockResolvedValue({ id: partId.toString() }) } as unknown as IPecaGateway),
        new ListarMovimentacoesEstoqueUseCase(movementGateway), new EstoquePresenter());
    return { stock, movements, stockGateway, movementGateway, controller };
}
test('lists persisted stock and movements through the public presentation contract', async () => {
    const c = setup();
    expect(await c.controller.getAllEstoque()).toEqual([{ pecaId: partId.toString(), quantidade: 10 }]);
    expect(await c.controller.getEstoqueByPecaId(partId.toString())).toEqual({ pecaId: partId.toString(), quantidade: 10 });
    expect(await c.controller.listaMovimentacoes()).toEqual([{ id: movementId.toString(), pecaId: partId.toString(), quantidade: 4, tipo: 'SAIDA', origem: 'ordem', data: at }]);
});
test('returns null for malformed or missing parts without querying malformed ObjectIds', async () => {
    const c = setup(false);
    expect(await c.controller.getEstoqueByPecaId('invalid')).toBeNull();
    expect(c.stock.findOne).not.toHaveBeenCalled();
    expect(await c.controller.getEstoqueByPecaId(partId.toString())).toBeNull();
});
test('persists a stock deduction and its movement with the resulting quantity', async () => {
    const c = setup();
    expect(await c.controller.createMovimentacao({ pecaId: partId.toString(), quantidade: 4, tipo: 'SAIDA', origem: 'ordem', data: at }))
        .toEqual({ id: movementId.toString(), pecaId: partId.toString(), quantidade: 4, tipo: 'SAIDA', origem: 'ordem', data: at });
    expect(c.stock.updateOne).toHaveBeenCalledWith({ pecaId: partId }, { $set: { quantidade: 6 } });
    expect(c.stock.insertOne).not.toHaveBeenCalled();
    expect(c.movements.insertOne).toHaveBeenCalledWith(expect.objectContaining({ pecaId: partId, quantidade: 4 }));
});
test('inserts the first receipt instead of attempting to update missing stock', async () => {
    const c = setup(false);
    await c.controller.createMovimentacao({ pecaId: partId.toString(), quantidade: 4, tipo: 'ENTRADA', origem: 'compra', data: at });
    expect(c.stock.insertOne).toHaveBeenCalledWith({ pecaId: partId, quantidade: 4 });
    expect(c.stock.updateOne).not.toHaveBeenCalled();
});
test('does not record a movement when persistence of its stock change fails', async () => {
    const c = setup(); c.stock.updateOne.mockRejectedValue(new Error('database offline'));
    await expect(c.controller.createMovimentacao({ pecaId: partId.toString(), quantidade: 1, tipo: 'SAIDA', origem: 'ordem', data: at })).rejects.toThrow('database offline');
    expect(c.movements.insertOne).not.toHaveBeenCalled();
});
test('maps string and ObjectId persistence identifiers and preserves unsaved movement identity', () => {
    for (const id of [partId, partId.toString()]) {
        const stock = EstoqueMapper.toDomain({ pecaId: id, quantidade: 4 });
        expect(EstoqueMapper.toPersistence(stock)).toEqual({ pecaId: partId.toString(), quantidade: 4 });
        const restored = MovimentacaoEstoqueMapper.toDomain({ ...movement, pecaId: id, _id: undefined });
        expect(restored.id).toBeUndefined();
        expect(MovimentacaoEstoqueMapper.toPersistence(restored)).toEqual({ pecaId: partId.toString(), quantidade: 4, tipo: 'SAIDA', origem: 'ordem', data: at });
    }
    const created = MovimentacaoEstoque.create(partId.toString(), 'ENTRADA', 2, at, 'compra');
    expect(new EstoquePresenter().presentMovimentacao(created).id).toBeUndefined();
});
