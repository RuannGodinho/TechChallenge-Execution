import { RegistrarMovimentacaoAtomicaUseCase } from '../../src/application/usecases/estoque/registrar-movimentacao-atomica.usecase';
import { AtomicStockPort } from '../../src/application/ports/atomic-stock.port';
import { InventoryRuleError } from '../../src/enterprise/entities/inventory-error';
import { Peca } from '../../src/enterprise/entities/peca.entity';
const movement = { pecaId:'part',tipo:'ENTRADA',quantidade:2,origem:'compra' };
const applyMovement=jest.fn(); const findById=jest.fn(); const newId=jest.fn(()=> 'generated');
const stock = { applyMovement } as unknown as AtomicStockPort;
beforeEach(()=>{jest.clearAllMocks();findById.mockResolvedValue(Peca.create('Filtro','Descricao',10,'PECA'));applyMovement.mockResolvedValue({id:'result'});});
test('uses domain movement values and preserves a supplied retry identity',async()=>{
 const useCase=new RegistrarMovimentacaoAtomicaUseCase(stock,{findById},newId);
 await useCase.execute(movement,'retry-1');
 const [domain,id]=applyMovement.mock.calls[0];expect(domain.tipo.value).toBe('ENTRADA');expect(domain.quantidade.value).toBe(2);expect(id).toBe('retry-1');expect(newId).not.toHaveBeenCalled();
});
test('invalid quantities and missing parts cannot reach stock persistence',async()=>{
 const useCase=new RegistrarMovimentacaoAtomicaUseCase(stock,{findById},newId);
 await expect(useCase.execute({...movement,quantidade:0})).rejects.toBeInstanceOf(InventoryRuleError);
 findById.mockResolvedValue(null);await expect(useCase.execute(movement)).rejects.toMatchObject({kind:'not_found'});expect(applyMovement).not.toHaveBeenCalled();
});
