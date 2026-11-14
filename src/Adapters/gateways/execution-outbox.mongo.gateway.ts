import { randomUUID } from 'node:crypto';
import { Db } from 'mongodb';
import { EventOutbox, IntegrationEvent, OutboxMessage } from '../../application/ports/integration-event';
interface Row { _id:string;event:IntegrationEvent;publishedAt:Date|null;attempts:number;nextAttemptAt:Date;leaseOwner?:string;leaseUntil?:Date;lastError?:string; }
export class ExecutionOutboxMongoGateway implements EventOutbox {
    private readonly owner=randomUUID();
    private readonly collection;
    constructor(db:Db) { this.collection=db.collection<Row>('ExecutionOutbox'); }
    async claim():Promise<OutboxMessage|null> {
        const now=new Date();
        const row=await this.collection.findOneAndUpdate({ publishedAt:null,attempts:{$lt:10},nextAttemptAt:{$lte:now},$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lt:now}}] }, { $set:{leaseOwner:this.owner,leaseUntil:new Date(now.getTime()+30000)},$inc:{attempts:1} }, {returnDocument:'after',sort:{nextAttemptAt:1}});
        return row ? {id:row._id,event:row.event} : null;
    }
    async markPublished(id:string) {
        const result=await this.collection.updateOne({_id:id,leaseOwner:this.owner},{$set:{publishedAt:new Date()},$unset:{leaseOwner:'',leaseUntil:'',lastError:''}});
        if(!result.modifiedCount) throw new Error('Outbox lease no longer owned');
    }
    async markFailed(id:string,error:string) {
        const row=await this.collection.findOne({_id:id,leaseOwner:this.owner});
        if(row) await this.collection.updateOne({_id:id,leaseOwner:this.owner},{$set:{lastError:error.slice(0,1000),nextAttemptAt:new Date(Date.now()+Math.min(60000,2**row.attempts*1000))},$unset:{leaseOwner:'',leaseUntil:''}});
    }
}
