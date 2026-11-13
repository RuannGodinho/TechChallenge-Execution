import { ConsultarEstoqueUseCase } from '../../application/usecases/estoque/consultar-estoque.usecase';
import { MovementInput, RegistrarMovimentacaoAtomicaUseCase } from '../../application/usecases/estoque/registrar-movimentacao-atomica.usecase';
import { presentMovement, presentStock } from '../presenters/atomic-estoque.presenter';

export class AtomicEstoqueController {
    constructor(private readonly queries: ConsultarEstoqueUseCase, private readonly register: RegistrarMovimentacaoAtomicaUseCase) {}
    async getAllEstoque() { return (await this.queries.list()).map(presentStock); }
    async getEstoqueByPecaId(id: string) { const stock = await this.queries.find(id); return stock ? presentStock(stock) : null; }
    async listaMovimentacoes() { return (await this.queries.history()).map(presentMovement); }
    async createMovimentacao(input: MovementInput, operationId?: string) { return presentMovement(await this.register.execute(input, operationId)); }
}
