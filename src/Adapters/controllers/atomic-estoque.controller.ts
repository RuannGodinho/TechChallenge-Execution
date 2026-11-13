import { Db, ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { TipoMovimentacao } from '../../enterprise/value-objects/tipo-movimentacao.vo';
import { OrigemMovimentacao } from '../../enterprise/value-objects/origem-movimentacao.vo';

/** Original HTTP methods backed by atomic stock/document updates. */
export class AtomicEstoqueController {
    constructor(private readonly db: Db) {}
    async getAllEstoque() {
        const rows = await this.db.collection('Estoque').find().toArray();
        return rows.map(row => ({ pecaId: row.pecaId.toString(), quantidade: row.quantidade }));
    }
    async getEstoqueByPecaId(pecaId: string) {
        const row = await this.db.collection('Estoque').findOne({ pecaId: new ObjectId(pecaId) });
        return row ? { pecaId, quantidade: row.quantidade } : null;
    }
    async listaMovimentacoes() {
        const stocks = await this.db.collection('Estoque').find().toArray();
        const embedded = stocks.flatMap(row => (row.movimentos ?? []).map((entry: any) => this.present(row.pecaId.toString(), entry)));
        const legacy = await this.db.collection('MovimentacoesEstoque').find().toArray();
        return [...legacy.map(row => ({ id: row._id.toString(), pecaId: row.pecaId.toString(), tipo: row.tipo, quantidade: row.quantidade, data: row.data, origem: row.origem })), ...embedded];
    }
    private present(pecaId: string, entry: any) {
        return { id: entry.key, pecaId, tipo: entry.type === 'RECEIVE' || entry.type === 'ENTRADA' ? 'ENTRADA' : 'SAIDA', quantidade: entry.quantity, data: entry.at, origem: entry.origem ?? (entry.type === 'CONSUME' ? 'OS' : 'compra') };
    }
    async createMovimentacao(input: { pecaId: string; tipo: string; quantidade: number; origem: string }, operationId: string = randomUUID()) {
        if (!input || !ObjectId.isValid(input.pecaId) || !Number.isSafeInteger(input.quantidade) || input.quantidade <= 0 || typeof input.tipo !== 'string' || typeof input.origem !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(operationId)) throw new Error('Movimentação inválida');
        const tipo = TipoMovimentacao.from(input.tipo).value;
        const origem = OrigemMovimentacao.from(input.origem).value;
        const pecaId = new ObjectId(input.pecaId);
        if (!await this.db.collection('Pecas').findOne({ _id: pecaId })) throw Object.assign(new Error('Peça não encontrada'), { status: 404 });
        const key = `movement:${operationId}`;
        const entry = { key, type: tipo, quantity: input.quantidade, origem, at: new Date() };
        const stock = this.db.collection('Estoque');
        const filter = { pecaId, 'movimentos.key': { $ne: key }, ...(tipo === 'SAIDA' ? { quantidade: { $gte: input.quantidade } } : {}) };
        const update = { $inc: { quantidade: tipo === 'ENTRADA' ? input.quantidade : -input.quantidade }, $push: { movimentos: entry } };
        try {
            const result = await stock.updateOne(filter, update as never, { upsert: tipo === 'ENTRADA' });
            if (result.modifiedCount || result.upsertedCount) return this.present(input.pecaId, entry);
        } catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
            // Concurrent first receipts race on the unique part index; retry without upsert.
            const retry = await stock.updateOne(filter, update as never);
            if (retry.modifiedCount) return this.present(input.pecaId, entry);
        }
        const row = await stock.findOne({ pecaId, 'movimentos.key': key }, { projection: { movimentos: { $elemMatch: { key } } } });
        const previous = row?.movimentos?.[0];
        if (previous && previous.type === tipo && previous.quantity === input.quantidade && previous.origem === origem) return this.present(input.pecaId, previous);
        throw Object.assign(new Error(previous ? 'Chave de operação já utilizada com outros dados' : 'Quantidade insuficiente em estoque'), { status: 409 });
    }
}
