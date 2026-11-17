import { randomUUID } from 'node:crypto';
import { Db, ObjectId } from 'mongodb';
import { PreparacaoExecucao, FalhaPreparacao } from '../../enterprise/entities/preparacao-execucao';
import { SagaMessage } from '../../infrastructure/messaging/saga';
export class PreparacaoExecucaoMongoGateway {
    constructor(private readonly db: Db) { }
    async execute(m: SagaMessage) {
        const session = this.db.client.startSession();
        try {
            await session.withTransaction(async () => {
                const opts = { session };
                const preparations = this.db.collection<any>('PreparacoesExecucao');
                const inbox = this.db.collection<any>('SagaInbox');
                if (await inbox.findOne({ _id: m.data.commandId }, opts))
                    return;
                await preparations.updateOne({ _id: m.data.sagaId }, { $setOnInsert: { orderId: m.orderId, attempt: m.data.attempt, state: 'NOVA', parts: [] }, $inc: { revision: 1 } }, { ...opts, upsert: true });
                const p = await preparations.findOne({ _id: m.data.sagaId }, opts);
                if (p.orderId !== m.orderId || p.attempt !== m.data.attempt)
                    throw Error('Saga identity mismatch');
                let data: any = { ...m.data, ok: true };
                delete data.snapshot;
                // Roll back business failures before persisting their result in a separate transaction.
                PreparacaoExecucao.permitir(p.state, m.eventType);
                const stock = this.db.collection('Estoque');
                const executions = this.db.collection('ExecucoesServico');
                const orderId = new ObjectId(m.orderId);
                if (m.eventType === 'execution.ReservarEstoque' && p.state === 'NOVA') {
                    const parts = m.data.snapshot?.pecas ?? [];
                    PreparacaoExecucao.validarReserva(parts);
                    for (const part of parts) {
                        const result = await stock.updateOne({ pecaId: new ObjectId(part.id), $expr: { $gte: [{ $subtract: ['$quantidade', { $ifNull: ['$reservado', 0] }] }, part.quantidade] } }, { $inc: { reservado: part.quantidade } }, opts);
                        if (!result.modifiedCount)
                            throw new FalhaPreparacao('Estoque insuficiente');
                    }
                    await preparations.updateOne({ _id: p._id }, { $set: { parts, state: 'RESERVADA', snapshot: m.data.snapshot } }, opts);
                }
                else if (m.eventType === 'execution.PrepararExecucoes' && p.state === 'RESERVADA') {
                    for (const service of p.snapshot.servicos) {
                        if (!ObjectId.isValid(service.id) || !await this.db.collection('Servicos').findOne({ _id: new ObjectId(service.id) }, opts))
                            throw new FalhaPreparacao('Serviço não encontrado');
                        await executions.updateOne({ ordemServicoId: orderId, servicoId: new ObjectId(service.id) }, { $setOnInsert: { status: 'PENDENTE', criadoEm: new Date(), sagaId: p._id } }, { ...opts, upsert: true });
                        const row = await executions.findOne({ ordemServicoId: orderId, servicoId: new ObjectId(service.id) }, opts);
                        if (row?.sagaId !== p._id)
                            throw new FalhaPreparacao('Execução pertence a outra preparação');
                    }
                    await preparations.updateOne({ _id: p._id }, { $set: { state: 'PREPARADA' } }, opts);
                }
                else if (m.eventType === 'execution.AutorizarExecucao' && p.state === 'PREPARADA') {
                    for (const part of p.parts) {
                        const result = await stock.updateOne({ pecaId: new ObjectId(part.id), reservado: { $gte: part.quantidade }, quantidade: { $gte: part.quantidade } }, { $inc: { quantidade: -part.quantidade, reservado: -part.quantidade }, $push: { movimentos: { key: `saga:${p._id}:consume`, type: 'CONSUME', quantity: part.quantidade, at: new Date(), origem: 'OS' } } } as never, opts);
                        if (!result.modifiedCount)
                            throw new FalhaPreparacao('Reserva indisponível');
                    }
                    await preparations.updateOne({ _id: p._id }, { $set: { state: 'AUTORIZADA' } }, opts);
                }
                else if (m.eventType === 'execution.CancelarPreparacao') {
                    if (await executions.findOne({ ordemServicoId: orderId, sagaId: p._id, status: { $ne: 'PENDENTE' } }, opts))
                        throw new FalhaPreparacao('Execução já iniciada');
                    const cancelled = await executions.find({ ordemServicoId: orderId, sagaId: p._id, status: 'PENDENTE' }, opts).toArray();
                    for (const row of cancelled)
                        await this.db.collection('ExecucoesCanceladas').updateOne({ _id: row._id }, { $setOnInsert: { ...row, canceladoEm: new Date() } }, { ...opts, upsert: true });
                    await executions.deleteMany({ ordemServicoId: orderId, sagaId: p._id, status: 'PENDENTE' }, opts);
                    await preparations.updateOne({ _id: p._id }, { $set: { state: 'CANCELADA', previousState: p.state === 'CANCELADA' ? p.previousState : p.state } }, opts);
                }
                else if (m.eventType === 'execution.LiberarEstoque') {
                    if (p.state !== 'CANCELADA')
                        throw new FalhaPreparacao('Cancelar preparação antes de liberar estoque');
                    if (!p.released) {
                        for (const part of p.parts) {
                            const consumed = p.previousState === 'AUTORIZADA';
                            await stock.updateOne({ pecaId: new ObjectId(part.id) }, consumed ? { $inc: { quantidade: part.quantidade }, $push: { movimentos: { key: `saga:${p._id}:refund`, type: 'RECEIVE', quantity: part.quantidade, at: new Date(), origem: 'OS' } } } as never : { $inc: { reservado: -part.quantidade } }, opts);
                        }
                        await preparations.updateOne({ _id: p._id }, { $set: { released: true } }, opts);
                    }
                }
                else if (!['RESERVADA', 'PREPARADA', 'AUTORIZADA'].includes(p.state)) {
                    throw new FalhaPreparacao('Etapa de preparação inválida');
                }
                await this.result(m, data, session);
            });
        }
        catch (e) {
            if (!(e instanceof FalhaPreparacao))
                throw e;
            await session.withTransaction(async () => { if (!await this.db.collection<any>('SagaInbox').findOne({ _id: m.data.commandId }, { session }))
                await this.result(m, { ...m.data, snapshot: undefined, ok: false, error: e.message }, session); });
        }
        finally {
            await session.endSession();
        }
    }
    private async result(m: SagaMessage, data: any, session: any) { const id = randomUUID(); const event = { messageId: id, eventType: 'saga.result', eventVersion: 1, orderId: m.orderId, occurredAt: new Date().toISOString(), data }; await this.db.collection<any>('SagaInbox').insertOne({ _id: m.data.commandId }, { session }); await this.db.collection<any>('SagaOutbox').insertOne({ _id: id, event, publishedAt: null, nextAttemptAt: new Date(), leaseUntil: null }, { session }); }
}
