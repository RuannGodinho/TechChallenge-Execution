import { Db, ObjectId } from 'mongodb';
import { PecaMongoGateway } from '../../src/Adapters/gateways/peca.mongo.gateway';
import { ServicoMongoGateway } from '../../src/Adapters/gateways/servico.mongo.gateway';
import { Peca } from '../../src/enterprise/entities/peca.entity';
import { Servico } from '../../src/enterprise/entities/servico.entity';
import { TipoItem } from '../../src/validators/tipo-item';

describe.each(['parts', 'services'])('%s persistence contracts', kind => {
    function setup(quantity?: number) {
        const id = new ObjectId();
        const row = { _id: id, nome: 'Filtro', descricao: 'Troca', preco: 30, tipo: 'PECA', quantidade: quantity };
        const collection = {
            find: jest.fn().mockReturnValue({ toArray: async () => [row] }), findOne: jest.fn().mockResolvedValue(row),
            insertOne: jest.fn().mockResolvedValue({ insertedId: id }), findOneAndUpdate: jest.fn().mockResolvedValue(row),
            deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
        };
        const db = { collection: jest.fn().mockReturnValue(collection) } as unknown as Db;
        const gateway = kind === 'parts' ? new PecaMongoGateway(db) : new ServicoMongoGateway(db);
        // Both gateways expose the same catalog operations, with different entity constructors.
        const entity = kind === 'parts' ? new Peca('Filtro', 'Troca', 30, TipoItem.PECA, undefined, quantity)
            : new Servico('Filtro', 'Troca', 30, undefined, quantity);
        return { id: id.toString(), collection, gateway, entity };
    }
    test('preserves catalog identity, prices and optional quantities on reads', async () => {
        const c = setup(2);
        expect((await c.gateway.findAll())[0]).toMatchObject({ id: c.id, preco: 30, quantidade: 2 });
        expect(await c.gateway.findById(c.id)).toMatchObject({ id: c.id, preco: 30 });
        c.collection.findOne.mockResolvedValue(null);
        expect(await c.gateway.findById(c.id)).toBeNull();
    });
    test('rejects malformed identifiers before accessing the database', async () => {
        const c = setup();
        expect(await c.gateway.findById('invalid')).toBeNull();
        expect(await c.gateway.update('invalid', c.entity as Peca & Servico)).toBeNull();
        expect(await c.gateway.delete('invalid')).toBe(false);
        expect(c.collection.findOne).not.toHaveBeenCalled();
        expect(c.collection.findOneAndUpdate).not.toHaveBeenCalled();
        expect(c.collection.deleteOne).not.toHaveBeenCalled();
    });
    test.each([undefined, 3])('creates and updates a catalog item with quantity %p', async quantity => {
        const c = setup(quantity);
        expect(await c.gateway.save(c.entity as Peca & Servico)).toMatchObject({ id: c.id, preco: 30 });
        expect(await c.gateway.update(c.id, c.entity as Peca & Servico)).toMatchObject({ id: c.id, preco: 30 });
        const update = c.collection.findOneAndUpdate.mock.calls[0][1];
        if (quantity === undefined) expect(update.$unset).toEqual({ quantidade: '' });
        else { expect(update.$set.quantidade).toBe(3); expect(update.$unset).toBeUndefined(); }
        c.collection.findOneAndUpdate.mockResolvedValue(null);
        expect(await c.gateway.update(c.id, c.entity as Peca & Servico)).toBeNull();
    });
    test('distinguishes a successful deletion from an absent item and propagates database failures', async () => {
        const c = setup();
        expect(await c.gateway.delete(c.id)).toBe(true);
        c.collection.deleteOne.mockResolvedValue({ deletedCount: 0 });
        expect(await c.gateway.delete(c.id)).toBe(false);
        c.collection.findOne.mockRejectedValue(new Error('database offline'));
        await expect(c.gateway.findById(c.id)).rejects.toThrow('database offline');
    });
});
