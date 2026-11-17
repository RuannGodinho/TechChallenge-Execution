import { executionCompletionEvent, ExecutionLifecycleConflict } from '../../enterprise/entities/execution-completion-event';
import { completionMessageId } from '../../infrastructure/messaging/execution-event';
import { Db, ObjectId, ClientSession } from 'mongodb';
import { ExecucaoServico } from '../../enterprise/entities/execucao-servico.entity';
import { IExecucaoServicoGateway } from '../../application/ports/execucao-servico.gateway.port';
import {
    ExecucaoServicoMapper,
    ExecucaoServicoPersistenceModel,
} from './mappers/execucao-servico.mapper';

export class ExecucaoServicoMongoGateway implements IExecucaoServicoGateway {
    private readonly collection;

    constructor(private readonly db: Db, private readonly messaging = false) {
        this.collection = this.db.collection<ExecucaoServicoPersistenceModel>('ExecucoesServico');
    }

    async save(execucao: ExecucaoServico): Promise<ExecucaoServico> {
        const persistence = ExecucaoServicoMapper.toPersistence(execucao);
        const result = await this.collection.insertOne(persistence as ExecucaoServicoPersistenceModel);

        return ExecucaoServico.restore({
            id: result.insertedId.toString(),
            ordemServicoId: execucao.ordemServicoId,
            servicoId: execucao.servicoId,
            status: execucao.status.value,
            criadoEm: execucao.criadoEm,
            iniciadoEm: execucao.iniciadoEm,
            finalizadoEm: execucao.finalizadoEm,
        });
    }

    async saveMany(execucoes: ExecucaoServico[]): Promise<void> {
        if (!execucoes.length) {
            return;
        }

        if (execucoes.length && await this.db.collection('PreparacoesExecucao').findOne({orderId:execucoes[0].ordemServicoId})) throw new ExecutionLifecycleConflict('Agendamento controlado pela Saga');
        const rows = execucoes.map((execucao) => ExecucaoServicoMapper.toPersistence(execucao));
        const persist = async (session?: ClientSession) => {
            if (session) {
                await this.lockBatch(execucoes[0].ordemServicoId, session);
                const batch = await this.db.collection('ExecutionBatches').findOne({ _id: new ObjectId(execucoes[0].ordemServicoId) }, { session });
                if (batch?.completed) {
                    const existing = await this.collection.find({ ordemServicoId: new ObjectId(execucoes[0].ordemServicoId) }, { session }).toArray();
                    const services = new Set(existing.map(item=>item.servicoId.toString()));
                    if (execucoes.some(item=>!services.has(item.servicoId))) throw new ExecutionLifecycleConflict('Completed order cannot receive new executions');
                    return;
                }
            }
            await this.collection.bulkWrite(rows.map(row => ({ updateOne: { filter: { ordemServicoId: row.ordemServicoId, servicoId: row.servicoId }, update: { $setOnInsert: row }, upsert: true } })), { ordered: false, session });
        };
        if (!this.messaging) { await persist(); return; }
        const session = this.db.client.startSession();
        try { await session.withTransaction(()=>persist(session)); }
        finally { await session.endSession(); }
    }

    async findById(id: string): Promise<ExecucaoServico | null> {
        if (!ObjectId.isValid(id)) {
            return null;
        }

        const row = await this.collection.findOne({ _id: new ObjectId(id) });
        return row ? ExecucaoServicoMapper.toDomain(row) : null;
    }

    async findByOrdemServicoId(ordemServicoId: string): Promise<ExecucaoServico[]> {
        if (!ObjectId.isValid(ordemServicoId)) {
            return [];
        }

        const rows = await this.collection
            .find({ ordemServicoId: new ObjectId(ordemServicoId) })
            .toArray();

        return rows.map((row) => ExecucaoServicoMapper.toDomain(row));
    }

    async findFinalizadas(): Promise<ExecucaoServico[]> {
        const rows = await this.collection
            .find({
                status: 'FINALIZADO',
                iniciadoEm: { $exists: true },
                finalizadoEm: { $exists: true },
            } as Record<string, unknown>)
            .toArray();

        return rows.map((row) => ExecucaoServicoMapper.toDomain(row));
    }

    async update(id: string, execucao: Partial<ExecucaoServico>): Promise<ExecucaoServico | null> {
        if (execucao.status?.value === 'EM EXECUCAO' && ObjectId.isValid(id)) { const row=await this.collection.findOne({_id:new ObjectId(id)}); const sagaId=(row as any)?.sagaId; if(sagaId && !await this.db.collection<any>('PreparacoesExecucao').findOne({_id:sagaId,state:'AUTORIZADA'})) throw new ExecutionLifecycleConflict('Preparação não autorizada'); }
        if (!this.messaging || execucao.status?.value !== 'FINALIZADO') return this.updateRecord(id,execucao);
        if (!ObjectId.isValid(id)) return null;
        const session = this.db.client.startSession();
        try {
            return await session.withTransaction(async () => {
                const previous = await this.collection.findOne({ _id:new ObjectId(id) }, { session });
                if (!previous) return null;
                const orderId = previous.ordemServicoId.toString();
                await this.lockBatch(orderId,session);
                const updated = await this.updateRecord(id,execucao,session);
                if (updated?.status.value === 'FINALIZADO') await this.recordCompletion(orderId,session);
                return updated;
            });
        } finally { await session.endSession(); }
    }

    private async updateRecord(id: string, execucao: Partial<ExecucaoServico>, session?: ClientSession): Promise<ExecucaoServico | null> {
        if (!ObjectId.isValid(id)) {
            return null;
        }

        const updates: Record<string, unknown> = {};

        if (execucao.status) {
            updates.status = execucao.status.value;
        }

        if (execucao.iniciadoEm) {
            updates.iniciadoEm = execucao.iniciadoEm;
        }

        if (execucao.finalizadoEm) {
            updates.finalizadoEm = execucao.finalizadoEm;
        }

        const result = await this.collection.findOneAndUpdate(
            { _id: new ObjectId(id), ...(execucao.status ? { status: execucao.status.value === 'EM EXECUCAO' ? 'PENDENTE' : 'EM EXECUCAO' } : {}) },
            { $set: updates },
            { returnDocument: 'after', session }
        );

        if (result) return ExecucaoServicoMapper.toDomain(result);
        const row = await this.collection.findOne({ _id:new ObjectId(id) }, { session });
        const current = row ? ExecucaoServicoMapper.toDomain(row) : null;
        return current?.status.value === execucao.status?.value ? current : null;
    }
    private async lockBatch(orderId: string, session: ClientSession) {
        await this.db.collection('ExecutionBatches').updateOne({ _id:new ObjectId(orderId) }, { $inc:{revision:1}, $setOnInsert:{completed:false} }, { upsert:true,session });
    }
    private async recordCompletion(orderId: string, session: ClientSession): Promise<boolean> {
        const rows = await this.collection.find({ ordemServicoId:new ObjectId(orderId) }, { session }).toArray();
        const event = executionCompletionEvent(orderId,rows.map(row=>({id:row._id!.toString(),status:row.status,finishedAt:row.finalizadoEm})),completionMessageId(orderId));
        if (!event) return false;
        await this.db.collection<{_id:string;event:typeof event;publishedAt:null;attempts:number;nextAttemptAt:Date}>('ExecutionOutbox').updateOne({ _id:event.messageId }, { $setOnInsert:{ event,publishedAt:null,attempts:0,nextAttemptAt:new Date(0) } }, { upsert:true,session });
        await this.db.collection('ExecutionBatches').updateOne({ _id:new ObjectId(orderId) }, { $set:{completed:true,messageId:event.messageId} }, { session });
        return true;
    }
    async ensureCompletionEnqueued(orderId: string): Promise<void> {
        const session = this.db.client.startSession();
        try {
            await session.withTransaction(async()=>{
                await this.lockBatch(orderId,session);
                if (!await this.recordCompletion(orderId,session)) throw new ExecutionLifecycleConflict('Order executions are not completed');
            });
        } finally { await session.endSession(); }
    }

}
