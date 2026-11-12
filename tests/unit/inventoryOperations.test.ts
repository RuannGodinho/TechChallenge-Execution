import { InventoryOperationsMongoGateway, InventoryUnavailableError, InventoryConflictError } from '../../src/Adapters/gateways/inventory-operations.mongo.gateway';
import { ObjectId, Db } from 'mongodb';

const partId = new ObjectId().toString();
const orderId = new ObjectId().toString();
function setup() {
 const updateOne = jest.fn(); const findOne = jest.fn();
 const db = { collection: () => ({ updateOne, findOne }) } as unknown as Db;
 return { gateway: new InventoryOperationsMongoGateway(db), updateOne, findOne };
}
test('consumption atomically enforces quantity and operation uniqueness', async () => {
 const { gateway, updateOne } = setup(); updateOne.mockResolvedValue({ modifiedCount: 1 });
 await expect(gateway.consume(orderId, partId, 2)).resolves.toBe('applied');
 expect(updateOne).toHaveBeenCalledWith(
  { pecaId: new ObjectId(partId), quantidade: { $gte: 2 }, 'movimentos.key': { $ne: `order:${orderId}` } },
  expect.objectContaining({ $inc: { quantidade: -2 }, $push: { movimentos: expect.objectContaining({ key: `order:${orderId}`, quantity: 2 }) } }),
 );
});
test('a duplicate consume succeeds without deducting again, but differing quantity conflicts', async () => {
 const { gateway, updateOne, findOne } = setup(); updateOne.mockResolvedValue({ modifiedCount: 0 });
 findOne.mockResolvedValue({ movimentos: [{ type: 'CONSUME', quantity: 2 }] });
 await expect(gateway.consume(orderId, partId, 2)).resolves.toBe('duplicate');
 await expect(gateway.consume(orderId, partId, 3)).rejects.toBeInstanceOf(InventoryConflictError);
});
test('consumption fails when stock is insufficient and not previously consumed', async () => {
 const { gateway, updateOne, findOne } = setup(); updateOne.mockResolvedValue({ modifiedCount: 0 }); findOne.mockResolvedValue(null);
 await expect(gateway.consume(orderId, partId, 2)).rejects.toBeInstanceOf(InventoryUnavailableError);
});
test('stock check recognizes prior consumption on a retry', async () => {
 const { gateway, findOne } = setup(); findOne.mockResolvedValue({ movimentos: [{ type: 'CONSUME', quantity: 2 }] });
 await expect(gateway.check(partId, 2, orderId)).resolves.toBe(true);
 expect(findOne).toHaveBeenCalledTimes(1);
});
