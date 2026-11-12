import { Db, ObjectId } from 'mongodb';
import { InventoryOperations } from '../../application/ports/inventory-operations.port';

export class InventoryConflictError extends Error {}
export class InventoryUnavailableError extends Error {}
export class InventoryOperationsMongoGateway implements InventoryOperations {
 private readonly stock;
 constructor(db: Db) { this.stock = db.collection('Estoque'); }
 async check(partId: string, quantity: number, orderId?: string): Promise<boolean> {
  const id = new ObjectId(partId);
  if (orderId && await this.duplicate(id, `order:${orderId}`, 'CONSUME', quantity)) return true;
  return !!await this.stock.findOne({ pecaId: id, quantidade: { $gte: quantity } }, { projection: { _id: 1 } });
 }
 private async duplicate(partId: ObjectId, key: string, type: string, quantity: number): Promise<boolean> {
  const row = await this.stock.findOne({ pecaId: partId, 'movimentos.key': key }, { projection: { movimentos: { $elemMatch: { key } } } });
  if (!row) return false;
  const entry = row.movimentos?.[0];
  if (entry?.type !== type || entry?.quantity !== quantity) throw new InventoryConflictError('operation key already used with different data');
  return true;
 }
 async consume(orderId: string, partId: string, quantity: number): Promise<'applied' | 'duplicate'> {
  const id = new ObjectId(partId); const key = `order:${orderId}`;
  const result = await this.stock.updateOne({ pecaId: id, quantidade: { $gte: quantity }, 'movimentos.key': { $ne: key } }, { $inc: { quantidade: -quantity }, $push: { movimentos: { key, type: 'CONSUME', quantity, at: new Date() } } } as never);
  if (result.modifiedCount) return 'applied';
  if (await this.duplicate(id, key, 'CONSUME', quantity)) return 'duplicate';
  throw new InventoryUnavailableError('insufficient inventory');
 }
 async receive(operationId: string, partId: string, quantity: number): Promise<'applied' | 'duplicate'> {
  const id = new ObjectId(partId); const key = `receive:${operationId}`;
  // A unique index on pecaId prevents concurrent first receipts creating two records.
  try {
   const result = await this.stock.updateOne({ pecaId: id, 'movimentos.key': { $ne: key } }, { $inc: { quantidade: quantity }, $push: { movimentos: { key, type: 'RECEIVE', quantity, at: new Date() } } } as never, { upsert: true });
   if (result.modifiedCount || result.upsertedCount) return 'applied';
  } catch (error: unknown) {
   if (!(typeof error === 'object' && error && 'code' in error && error.code === 11000)) throw error;
  }
  if (await this.duplicate(id, key, 'RECEIVE', quantity)) return 'duplicate';
  // A competing first receipt may have created the row; retry once without upsert.
  const retry = await this.stock.updateOne({ pecaId: id, 'movimentos.key': { $ne: key } }, { $inc: { quantidade: quantity }, $push: { movimentos: { key, type: 'RECEIVE', quantity, at: new Date() } } } as never);
  if (retry.modifiedCount) return 'applied';
  if (await this.duplicate(id, key, 'RECEIVE', quantity)) return 'duplicate';
  throw new Error('inventory receipt conflict');
 }
}
