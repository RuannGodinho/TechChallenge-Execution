import { Db, ObjectId } from 'mongodb';
import { AtomicStockPort, MovementView } from '../../application/ports/atomic-stock.port';
import { MovimentacaoEstoque } from '../../enterprise/entities/movimentacao-estoque.entity';
import { InventoryRuleError } from '../../enterprise/entities/inventory-error';

interface StoredMovement { key: string; type: string; quantity: number; at: Date; origem?: string; }
export class AtomicStockMongoGateway implements AtomicStockPort {
    constructor(private readonly db: Db) {}
    async findAll() {
        const rows = await this.db.collection('Estoque').find().toArray();
        return rows.map(row => ({ partId: row.pecaId.toString(), quantity: row.quantidade as number }));
    }
    async findByPartId(partId: string) {
        const row = await this.db.collection('Estoque').findOne({ pecaId: new ObjectId(partId) });
        return row ? { partId, quantity: row.quantidade as number } : null;
    }
    async listMovements() {
        const stocks = await this.db.collection('Estoque').find().toArray();
        const embedded = stocks.flatMap(row => ((row.movimentos ?? []) as StoredMovement[]).map(entry => this.mapMovement(row.pecaId.toString(), entry)));
        const legacy = await this.db.collection('MovimentacoesEstoque').find().toArray();
        return [...legacy.map(row => ({ id: row._id.toString(), partId: row.pecaId.toString(), type: row.tipo as string, quantity: row.quantidade as number, occurredAt: row.data as Date, origin: row.origem as string })), ...embedded];
    }
    private mapMovement(partId: string, entry: StoredMovement): MovementView {
        return { id: entry.key, partId, type: entry.type === 'RECEIVE' || entry.type === 'ENTRADA' ? 'ENTRADA' : 'SAIDA', quantity: entry.quantity, occurredAt: entry.at, origin: entry.origem ?? (entry.type === 'CONSUME' ? 'OS' : 'compra') };
    }
    async applyMovement(movement: MovimentacaoEstoque, operationId: string): Promise<MovementView> {
        const pecaId = new ObjectId(movement.pecaId.value);
        const tipo = movement.tipo.value; const quantity = movement.quantidade.value;
        const key = `movement:${operationId}`;
        const entry: StoredMovement = { key, type: tipo, quantity, origem: movement.origem.value, at: movement.data };
        const stock = this.db.collection('Estoque');
        const filter = { pecaId, 'movimentos.key': { $ne: key }, ...(movement.tipo.isSaida() ? { quantidade: { $gte: quantity } } : {}) };
        const update = { $inc: { quantidade: movement.tipo.isEntrada() ? quantity : -quantity }, $push: { movimentos: entry } };
        try {
            const result = await stock.updateOne(filter, update as never, { upsert: movement.tipo.isEntrada() });
            if (result.modifiedCount || result.upsertedCount) return this.mapMovement(movement.pecaId.value, entry);
        } catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
            const retry = await stock.updateOne(filter, update as never);
            if (retry.modifiedCount) return this.mapMovement(movement.pecaId.value, entry);
        }
        const row = await stock.findOne({ pecaId, 'movimentos.key': key }, { projection: { movimentos: { $elemMatch: { key } } } });
        const previous = row?.movimentos?.[0] as StoredMovement | undefined;
        if (previous && previous.type === tipo && previous.quantity === quantity && previous.origem === entry.origem) return this.mapMovement(movement.pecaId.value, previous);
        throw new InventoryRuleError('conflict', previous ? 'Chave de operação já utilizada com outros dados' : 'Quantidade insuficiente em estoque');
    }
}
