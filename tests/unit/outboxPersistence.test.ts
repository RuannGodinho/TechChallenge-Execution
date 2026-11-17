import { Db } from 'mongodb';
import { ExecutionOutboxMongoGateway } from '../../src/Adapters/gateways/execution-outbox.mongo.gateway';
import { SagaMongoOutbox } from '../../src/Adapters/gateways/saga-outbox.mongo.gateway';

const event = { messageId: 'message', eventType: 'execution.completed' };
function setup() {
    const collection = { findOneAndUpdate: jest.fn().mockResolvedValue({ _id: 'message', event }),
        findOne: jest.fn().mockResolvedValue({ attempts: 3 }), updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
    const db = { collection: jest.fn().mockReturnValue(collection) } as unknown as Db;
    return { collection, db };
}
beforeEach(() => { jest.useFakeTimers().setSystemTime(Date.parse('2026-01-01T00:00:00Z')); });
afterEach(() => jest.useRealTimers());
test('claims an execution event with a bounded lease and a stable owner', async () => {
    const c = setup(), gateway = new ExecutionOutboxMongoGateway(c.db);
    expect(await gateway.claim()).toEqual({ id: 'message', event });
    const [filter, update] = c.collection.findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({ publishedAt: null, attempts: { $lt: 10 }, nextAttemptAt: { $lte: new Date() } });
    expect(update.$set.leaseUntil.getTime() - Date.now()).toBe(30000);
    await gateway.markPublished('message');
    expect(c.collection.updateOne).toHaveBeenCalledWith({ _id: 'message', leaseOwner: update.$set.leaseOwner },
        { $set: { publishedAt: new Date() }, $unset: { leaseOwner: '', leaseUntil: '', lastError: '' } });
    c.collection.findOneAndUpdate.mockResolvedValue(null);
    expect(await gateway.claim()).toBeNull();
});
test('refuses to mark an execution event published after losing its lease', async () => {
    const c = setup(), gateway = new ExecutionOutboxMongoGateway(c.db);
    c.collection.updateOne.mockResolvedValue({ modifiedCount: 0 });
    await expect(gateway.markPublished('message')).rejects.toThrow('Outbox lease no longer owned');
});
test.each([3, 10])('backs off and truncates execution publication errors after %s attempts', async attempts => {
    const c = setup(), gateway = new ExecutionOutboxMongoGateway(c.db); c.collection.findOne.mockResolvedValue({ attempts });
    await gateway.markFailed('message', 'x'.repeat(1500));
    expect(c.collection.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: 'message' }), {
        $set: { lastError: 'x'.repeat(1000), nextAttemptAt: new Date(Date.now() + Math.min(60000, 2 ** attempts * 1000)) },
        $unset: { leaseOwner: '', leaseUntil: '' },
    });
});
test('does not reschedule an execution event now owned by another publisher', async () => {
    const c = setup(), gateway = new ExecutionOutboxMongoGateway(c.db); c.collection.findOne.mockResolvedValue(null);
    await gateway.markFailed('message', 'offline');
    expect(c.collection.updateOne).not.toHaveBeenCalled();
});
test('claims and acknowledges a Saga event using the same lease owner', async () => {
    const c = setup(), gateway = new SagaMongoOutbox(c.db);
    expect(await gateway.claim()).toEqual({ id: 'message', event });
    const owner = c.collection.findOneAndUpdate.mock.calls[0][1].$set.owner;
    await gateway.markPublished('message');
    expect(c.collection.updateOne).toHaveBeenCalledWith({ _id: 'message', owner }, { $set: { publishedAt: new Date(), leaseUntil: null } });
    c.collection.findOneAndUpdate.mockResolvedValue(null);
    expect(await gateway.claim()).toBeNull();
});
test.each([undefined, 3, 10])('bounds Saga retries when the stored attempt count is %p', async attempts => {
    const c = setup(), gateway = new SagaMongoOutbox(c.db); c.collection.findOne.mockResolvedValue({ attempts });
    await gateway.markFailed('message', 'x'.repeat(1500));
    const update = c.collection.updateOne.mock.calls[0][1].$set;
    expect(update.lastError).toHaveLength(1000);
    expect(update.nextAttemptAt.getTime() - Date.now()).toBe(Math.min(60, 2 ** Math.min(6, attempts ?? 1)) * 1000);
    expect(update.leaseUntil).toBeNull();
});
