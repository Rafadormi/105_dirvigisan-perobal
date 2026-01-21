
import { Component, signal, inject, computed, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CnpjService, CompanyData } from './src/services/cnpj.service';
import { RiskService, RiskAnalysisResult, RiskLevel, PendingResolution, CnaeRule } from './src/services/risk.service';
import { StorageService, SavedProcess } from './src/services/storage.service';
import { legacyCompanies } from './src/data/legacy-companies';
import { StatCardComponent } from './src/components/stat-card.component';
import { ActionCardComponent } from './src/components/action-card.component';

interface BatchResult {
  cnpj: string;
  company: CompanyData | null;
  risk: RiskAnalysisResult | null;
  status: 'loading' | 'success' | 'error';
  errorMsg?: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, StatCardComponent, ActionCardComponent],
  templateUrl: './app.component.html',
  styles: [`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');

    .animate-fade-in { animation: fadeIn 0.5s ease-out; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  `]
})
export class AppComponent implements AfterViewChecked {
  @ViewChild('logContainer') private logContainer: ElementRef | undefined;
  
  private cnpjService = inject(CnpjService);
  private riskService = inject(RiskService);
  private storageService = inject(StorageService);

  private cnpjInputSubject = new Subject<string>();

  view = 'dashboard';
  
  // Dashboard Stats
  cnaeRulesCount = this.riskService.cnaeRulesCount;
  totalCompanies = computed(() => this.historyList().length);
  highRiskCompanies = computed(() => this.historyList().filter(p => !p.isLegacy && p.riskAnalysis.riskLevel === 'ALTO').length);

  private healthCnaePrefixes = ['86', '87', '88', '4771', '4772', '4773', '3250'];
  cnesEstablishmentsCount = computed(() => {
    const history = this.historyList();
    const cnesCnpjs = new Set<string>();

    history.forEach(process => {
      if (!process.isLegacy && process.riskAnalysis) {
        const hasHealthCnae = process.riskAnalysis.cnaeDetails.some(detail => 
          this.healthCnaePrefixes.some(prefix => detail.code.startsWith(prefix))
        );
        if (hasHealthCnae) cnesCnpjs.add(process.id);
      } else if (process.isLegacy) {
        const name = process.company.razao_social.toUpperCase();
        if (name.includes('FARMACIA') || name.includes('HOSPITAL') || name.includes('CLINICA') || name.includes('MEDIC')) {
           cnesCnpjs.add(process.id);
        }
      }
    });
    return cnesCnpjs.size;
  });

  // Delete Modal State
  showDeleteModal = signal(false);
  itemToDelete = signal<string | null>(null);
  
  // Override Modal
  showOverrideModal = signal(false);
  manualOverrideReason = signal('');
  selectedManualRisk = signal<RiskLevel | null>(null);

  cnpjInput = signal('');
  loading = signal(false);
  errorMessage = signal<string | null>(null);
  
  // Settings
  receitaWsToken = signal(''); 
  isTokenVisible = signal(false);
  
  apiStatus = signal<'active' | 'error' | 'verifying'>('active');
  apiStatusMessage = signal('');
  tokenExpiresAt = signal<Date | null>(null);
  isTestingToken = signal(false);

  // Cooldown System
  searchCooldown = signal(0);
  private cooldownTimer: any = null;
  
  companyData = signal<CompanyData | null>(null);
  riskResult = signal<RiskAnalysisResult | null>(null);
  userAnswers = signal<Record<string, RiskLevel>>({}); 

  processNotes = signal(''); 
  showAllCnaes = signal(false);

  // Licensing and Responsible Persons
  licenseStatus = signal<'Ativa' | 'Vencida' | 'Em Renovação' | 'Suspensa' | 'Pendente' | undefined>(undefined);
  licenseNumber = signal('');
  licenseIssueDate = signal('');
  licenseExpiryDate = signal('');
  legalRepresentative = signal('');
  technicalRepresentative = signal('');

  historyList = signal<SavedProcess[]>([]);
  historySearchTerm = signal('');
  empresasSearchTerm = signal('');
  
  // CNAE View State
  cnaeSearchTerm = signal('');
  allCnaes = signal<CnaeRule[]>([]);
  filteredCnaes = computed(() => {
    const term = this.cnaeSearchTerm().toLowerCase().trim();
    if (!term) return this.allCnaes();
    return this.allCnaes().filter(rule => 
      rule.cnae.includes(term) || 
      rule.description.toLowerCase().includes(term)
    );
  });

  // Missing properties fixed
  missingCnaes = signal<{ code: string; description: string; foundIn: { cnpj: string; name: string } }[]>([]);
  showMissingCnaesReport = signal(false);

  // Batch Processing State
  batchInputText = signal('');
  batchResults = signal<BatchResult[]>([]);
  isBatchProcessing = signal(false);
  isBatchCancelled = signal(false);
  batchProgress = signal(0);
  batchTotal = signal(0);
  batchLog = signal<string[]>([]);
  batchPage = signal(1);
  batchPageSize = signal(10);
  batchSortColumn = signal<'cnpj' | 'razao_social' | 'risk' | 'status'>('status');
  batchSortDirection = signal<'asc' | 'desc'>('asc');
  
  sortedBatchResults = computed(() => {
    const results = [...this.batchResults()];
    const col = this.batchSortColumn();
    const dir = this.batchSortDirection() === 'asc' ? 1 : -1;

    return results.sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      switch (col) {
        case 'cnpj': valA = a.cnpj; valB = b.cnpj; break;
        case 'razao_social': valA = a.company?.razao_social || ''; valB = b.company?.razao_social || ''; break;
        case 'status': valA = a.status; valB = b.status; break;
        case 'risk':
          const riskWeight: Record<string, number> = { 'BAIXO': 1, 'MÉDIO': 2, 'CONDICIONADO': 3, 'ALTO': 4 };
          valA = riskWeight[a.risk?.riskLevel || ''] || 0;
          valB = riskWeight[b.risk?.riskLevel || ''] || 0;
          break;
      }
      if (valA < valB) return -1 * dir;
      if (valA > valB) return 1 * dir;
      return 0;
    });
  });

  paginatedBatchResults = computed(() => {
    const sorted = this.sortedBatchResults();
    const start = (this.batchPage() - 1) * this.batchPageSize();
    return sorted.slice(start, start + this.batchPageSize());
  });

  totalBatchPages = computed(() => {
    return Math.ceil(this.batchResults().length / this.batchPageSize()) || 1;
  });
  
  filteredHistory = computed(() => {
    const term = this.historySearchTerm().toLowerCase();
    return this.historyList().filter(item => 
      item.company.razao_social.toLowerCase().includes(term) || 
      item.id.includes(term) ||
      (item.company.nome_fantasia && item.company.nome_fantasia.toLowerCase().includes(term))
    );
  });
  
  filteredEmpresas = computed(() => {
    const term = this.empresasSearchTerm().toLowerCase();
    if (!term) {
        return this.historyList();
    }
    return this.historyList().filter(item => 
      item.company.razao_social.toLowerCase().includes(term) || 
      item.id.includes(term) ||
      (item.company.nome_fantasia && item.company.nome_fantasia.toLowerCase().includes(term))
    );
  });

  apiStatusTooltip = computed(() => {
    const status = this.apiStatus();
    const message = this.apiStatusMessage();
    const expiresAt = this.tokenExpiresAt();
    const isCommercial = !!this.receitaWsToken();
    
    let tooltip = '';
    tooltip += `API: ${isCommercial ? 'ReceitaWS (Comercial)' : 'ReceitaWS (Pública)'}\n`;
    tooltip += `Status: ${status === 'active' ? 'Conectado' : (status === 'verifying' ? 'Verificando...' : 'Erro')}\n`;
    if (message) tooltip += `Info: ${message}\n`;

    if (isCommercial) {
        if (expiresAt) {
            tooltip += `Expira em: ${this.formatJustDate(expiresAt)}`;
        } else {
             tooltip += `Validade: Indeterminado/Verificar Painel`;
        }
    } else {
        tooltip += `Limitação: 3 consultas/min (Delay auto: 28s)`;
    }
    return tooltip;
  });

  constructor() {
    this.storageService.initializeLegacyData(legacyCompanies);
    this.refreshHistory();
    const savedReceitaWs = localStorage.getItem('dirvigisan_receitaws_token');
    
    if (savedReceitaWs) {
      this.receitaWsToken.set(savedReceitaWs);
      this.apiStatusMessage.set('Token comercial carregado.');
    } else {
      this.receitaWsToken.set('');
      this.apiStatusMessage.set('API Pública: 1 consulta a cada 28s.');
    }

    this.cnpjInputSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntilDestroyed()
    ).subscribe(value => {
      this.cnpjInput.set(value);
    });
  }

  async ngAfterViewChecked() {
    this.scrollToBottom();
    // Load CNAE rules if view is active
    if (this.view === 'cnaes' && this.allCnaes().length === 0) {
       // Ensure rules are loaded in service then fetch
       await this.riskService.analyze([]); // Triggers load
       this.allCnaes.set(this.riskService.getAllRules());
    }
  }

  private scrollToBottom(): void {
    try {
      if (this.logContainer && this.isBatchProcessing()) {
        const element = this.logContainer.nativeElement;
        element.scrollTop = element.scrollHeight;
      }
    } catch (err) { }
  }

  refreshHistory() {
    this.historyList.set(this.storageService.getAll());
  }

  navigate(viewName: string) {
    this.view = viewName;
    if (viewName === 'history' || viewName === 'empresas') {
      this.refreshHistory();
    }
    if (viewName === 'cnaes') {
        this.loadCnaesForView();
    }
  }
  
  async loadCnaesForView() {
      // Trigger service load if needed
      await this.riskService.analyze([]); 
      this.allCnaes.set(this.riskService.getAllRules());
  }

  toggleTokenVisibility() {
    this.isTokenVisible.update(v => !v);
  }

  saveToken() {
    const receitaws = this.receitaWsToken().trim();
    if (receitaws) {
      localStorage.setItem('dirvigisan_receitaws_token', receitaws);
      this.testReceitaWsConnection(receitaws, true);
    } else {
      localStorage.removeItem('dirvigisan_receitaws_token');
      alert('Token personalizado removido. O sistema usará a API Pública.');
      this.apiStatus.set('active');
      this.tokenExpiresAt.set(null);
      this.apiStatusMessage.set('API Pública: 1 consulta a cada 28s.');
    }
  }

  triggerTestToken() {
    const token = this.receitaWsToken().trim();
    this.testReceitaWsConnection(token, true);
  }

  startCooldown(seconds: number = 28) {
    if (this.cooldownTimer) clearInterval(this.cooldownTimer);
    this.searchCooldown.set(seconds);
    this.cooldownTimer = setInterval(() => {
        this.searchCooldown.update(current => {
            if (current <= 1) {
                clearInterval(this.cooldownTimer);
                return 0;
            }
            return current - 1;
        });
    }, 1000);
  }

  testReceitaWsConnection(token: string, showAlert: boolean = true) {
    if (this.searchCooldown() > 0) {
        alert(`Aguarde ${this.searchCooldown()} segundos antes de testar a conexão novamente.`);
        return;
    }
    
    this.isTestingToken.set(true);
    this.apiStatus.set('verifying');
    this.apiStatusMessage.set('Testando conexão com API ReceitaWS (Consome 1 consulta)...');
    this.tokenExpiresAt.set(null); 
    
    this.cnpjService.checkReceitaWsTokenValidity(token).subscribe({
      next: (result) => {
        this.isTestingToken.set(false);
        this.apiStatusMessage.set(result.message);
        this.tokenExpiresAt.set(result.expiresAt || null);
        this.startCooldown(); 
        
        const apiName = result.apiName || 'API ReceitaWS';

        if (result.isValid) {
          this.apiStatus.set('active'); 
          if (showAlert) alert(`Conexão com ${apiName} bem sucedida!\n${result.message}`);
        } else {
          this.apiStatus.set('error');
          if (showAlert) alert(`Falha na conexão com ${apiName}:\n${result.message}`);
        }
      },
      error: (err) => {
        this.isTestingToken.set(false);
        this.apiStatus.set('error');
        this.startCooldown();
      }
    });
  }

  getApiStatusText(): string {
    switch(this.apiStatus()) {
        case 'active': return 'Operacional';
        case 'error': return 'Erro / Limitado';
        case 'verifying': return 'Verificando...';
        default: return 'Desconhecido';
    }
  }

  updateCnpj(event: Event) {
    const input = event.target as HTMLInputElement;
    let val = input.value.replace(/\D/g, '');
    if (val.length > 14) val = val.substring(0, 14);
    this.cnpjInputSubject.next(val);
  }

  search(overrideValue?: string) {
    if (this.searchCooldown() > 0) {
      alert(`Por favor, aguarde ${this.searchCooldown()} segundos para a próxima consulta.`);
      return;
    }
    
    let term = overrideValue !== undefined ? overrideValue : this.cnpjInput();
    term = term.replace(/\D/g, ''); 
    
    if (term.length !== 14 && term.length !== 11) {
      alert('Digite um CNPJ (14 dígitos) ou CPF (11 dígitos) válido.');
      return;
    }

    if (term !== this.cnpjInput()) {
       this.cnpjInput.set(term);
    }

    this.loading.set(true);
    this.errorMessage.set(null);
    this.resetFields();
    this.view = 'search';

    this.cnpjService.fetchCompany(term).subscribe({
      next: async (data) => {
        this.companyData.set(data);
        await this.analyzeRisk(data);
        this.loading.set(false);
        this.apiStatus.set('active');
        this.apiStatusMessage.set('Conexão estabelecida.');
        this.startCooldown(28); 
      },
      error: (err: Error) => {
        this.errorMessage.set(`ERRO DE API: ${err.message}`);
        this.loading.set(false);
        this.apiStatus.set('error');
        this.apiStatusMessage.set(err.message.substring(0, 50) + (err.message.length > 50 ? '...' : ''));
        this.startCooldown(28); 
      }
    });
  }

  async analyzeRisk(data: CompanyData) {
    const cnaes = [data.cnae_fiscal, ...data.cnaes_secundarios.map(s => String(s.codigo))];
    const analysis = await this.riskService.analyze(cnaes, this.userAnswers());
    this.riskResult.set(analysis);
  }

  // Answer a conditioned rule with Yes/No
  async answerCondition(item: PendingResolution, answer: boolean) {
    // Normaliza a chave para salvar a resposta (mesma lógica do RiskService)
    const cleanCnae = item.cnae.replace(/[^\d]/g, ''); 
    const rule = item.rule;
    if (!rule) return;

    const resolvedRisk = answer 
      ? (rule.riskIfYes || 'ALTO') 
      : (rule.riskIfNo || 'BAIXO');

    this.userAnswers.update(curr => ({
      ...curr,
      [cleanCnae]: resolvedRisk
    }));

    if (this.companyData()) {
      await this.analyzeRisk(this.companyData()!);
    }
  }

  saveProcess() {
    const data = this.companyData();
    const risk = this.riskResult();
    
    if (risk?.riskLevel === 'PENDENTE DE ANÁLISE') {
      alert('BLOQUEIO: Existem perguntas pendentes. Responda "SIM" ou "NÃO" nas condições listadas.');
      return;
    }

    if (data && risk) {
      const process: SavedProcess = {
        id: data.cnpj,
        company: data,
        riskAnalysis: risk,
        timestamp: new Date().toISOString(),
        notes: this.processNotes(),
        isLegacy: false,
        licenseStatus: this.licenseStatus() || 'Pendente',
        licenseNumber: this.licenseNumber(),
        licenseIssueDate: this.licenseIssueDate(),
        licenseExpiryDate: this.licenseExpiryDate(),
        legalRepresentative: this.legalRepresentative(),
        technicalRepresentative: this.technicalRepresentative(),
        userAnswers: this.userAnswers(), // Persist answers
      };
      this.storageService.save(process);
      alert('Processo salvo com sucesso!');
      this.refreshHistory();
    }
  }

  loadProcess(process: SavedProcess) {
    if (process.isLegacy) {
      this.search(process.id);
      return;
    }

    const company = { ...process.company };
    if (!company.fetchedAt) {
       company.fetchedAt = process.timestamp; 
    }

    this.companyData.set(company as CompanyData);
    this.riskResult.set(process.riskAnalysis);
    this.processNotes.set(process.notes || '');
    this.cnpjInput.set(process.id);
    this.showAllCnaes.set(false);
    this.userAnswers.set(process.userAnswers || {}); // Restore answers
    this.licenseStatus.set(process.licenseStatus);
    this.licenseNumber.set(process.licenseNumber || '');
    this.licenseIssueDate.set(process.licenseIssueDate || '');
    this.licenseExpiryDate.set(process.licenseExpiryDate || '');
    this.legalRepresentative.set(process.legalRepresentative || '');
    this.technicalRepresentative.set(process.technicalRepresentative || '');
    this.view = 'search';
  }

  requestDelete(event: Event, cnpj: string) {
    event.stopPropagation();
    this.itemToDelete.set(cnpj);
    this.showDeleteModal.set(true);
  }

  confirmDelete() {
    const cnpj = this.itemToDelete();
    if (cnpj) {
      this.storageService.delete(cnpj);
      this.refreshHistory();
    }
    this.closeDeleteModal();
  }

  closeDeleteModal() {
    this.showDeleteModal.set(false);
    this.itemToDelete.set(null);
  }
  
  openOverrideModal() {
    const currentRisk = this.riskResult();
    if (!currentRisk) return;
    this.selectedManualRisk.set(null);
    this.manualOverrideReason.set('');
    this.showOverrideModal.set(true);
  }

  closeOverrideModal() {
    this.showOverrideModal.set(false);
  }

  applyManualOverride() {
    const analysis = this.riskResult();
    const newRisk = this.selectedManualRisk();
    const reason = this.manualOverrideReason().trim();
    if (!analysis || !newRisk || !reason) {
      alert('Por favor, selecione um novo risco e forneça uma justificativa.');
      return;
    }
    this.riskResult.update(current => {
      if (!current) return null;
      const originalRisk = current.override ? current.override.originalRisk : current.riskLevel;
      return {
        ...current,
        riskLevel: newRisk,
        override: {
          originalRisk: originalRisk,
          manualRisk: newRisk,
          reason: reason
        }
      };
    });
    this.closeOverrideModal();
  }

  async processBatch() {
    const rawText = this.batchInputText();
    if (!rawText.trim()) {
      alert('Insira pelo menos um CNPJ.');
      return;
    }
    const cnpjs = rawText.split(/[\n,;]+/).map(s => s.replace(/\D/g, '')).filter(s => s.length === 14 || s.length === 11);
    if (cnpjs.length === 0) {
      alert('Nenhum CNPJ/CPF válido encontrado.');
      return;
    }

    this.isBatchProcessing.set(true);
    this.batchTotal.set(cnpjs.length);
    this.batchProgress.set(0);
    this.batchLog.set([]);
    this.isBatchCancelled.set(false);

    try {
        const token = this.receitaWsToken().trim();
        const check = await firstValueFrom(this.cnpjService.checkReceitaWsTokenValidity(token));

        if (!check.isValid) {
            alert(`Erro de Conexão: ${check.message}\nO processamento em lote não foi iniciado.`);
            this.isBatchProcessing.set(false);
            this.apiStatus.set('error');
            this.apiStatusMessage.set(check.message);
            return;
        }
        this.apiStatus.set('active');
    } catch (e) {
        alert('Falha ao tentar verificar a conexão com a API.');
        this.isBatchProcessing.set(false);
        return;
    }

    this.batchPage.set(1);
    this.batchResults.set(cnpjs.map(cnpj => ({ cnpj, company: null, risk: null, status: 'loading' })));

    if (!this.receitaWsToken().trim()) {
        this.batchLog.update(logs => [...logs, '>> MODO API PÚBLICA: Aguardando 28s para iniciar...']);
        await new Promise(r => setTimeout(r, 28000));
    }

    const currentResults = [...this.batchResults()];
    for (let i = 0; i < cnpjs.length; i++) {
      if (this.isBatchCancelled()) {
        this.batchLog.update(logs => [...logs, '>> Processamento cancelado pelo usuário.']);
        break;
      }
      
      const cnpj = cnpjs[i];
      this.batchLog.update(logs => [...logs, `[${i+1}/${cnpjs.length}] Consultando: ${this.formatCnpj(cnpj)}...`]);
      try {
        const data = await firstValueFrom(this.cnpjService.fetchCompany(cnpj));
        const cnaes = [data.cnae_fiscal, ...data.cnaes_secundarios.map(s => String(s.codigo))];
        const risk = await this.riskService.analyze(cnaes);
        currentResults[i] = { cnpj, company: data, risk: risk, status: 'success' };
        this.batchLog.update(logs => [...logs, `[SUCESSO] ${data.razao_social} - Risco: ${risk.riskLevel}`]);
        
        await new Promise(r => setTimeout(r, 28000));
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Falha na API';
        currentResults[i] = { ...currentResults[i], status: 'error', errorMsg: message };
        this.batchLog.update(logs => [...logs, `[ERRO] ${this.formatCnpj(cnpj)}: ${message}`]);
        await new Promise(r => setTimeout(r, 28000)); 
      }
      this.batchResults.set([...currentResults]);
      this.batchProgress.set(i + 1);
    }
    this.isBatchProcessing.set(false);
  }
  
  stopBatch() {
    this.isBatchCancelled.set(true);
  }

  getLogClass(log: string): string {
    if (log.startsWith('[SUCESSO]')) return 'text-green-400';
    if (log.startsWith('[ERRO]')) return 'text-red-400';
    if (log.startsWith('>>')) return 'text-yellow-400';
    return 'text-slate-400';
  }

  sortBatch(column: 'cnpj' | 'razao_social' | 'risk' | 'status') {
    if (this.batchSortColumn() === column) {
      this.batchSortDirection.set(this.batchSortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.batchSortColumn.set(column);
      this.batchSortDirection.set('asc');
    }
  }

  changeBatchPage(delta: number) {
    const newPage = this.batchPage() + delta;
    if (newPage >= 1 && newPage <= this.totalBatchPages()) {
      this.batchPage.set(newPage);
    }
  }
  
  setBatchPageSize(event: Event) {
    const size = parseInt((event.target as HTMLSelectElement).value, 10);
    this.batchPageSize.set(size);
    this.batchPage.set(1);
  }

  exportBatchCSV() {
    const results = this.sortedBatchResults().filter(r => r.status === 'success');
    if (results.length === 0) { alert('Sem resultados para exportar.'); return; }

    let maxSecCnaes = 0;
    results.forEach(r => {
        if (r.company && r.company.cnaes_secundarios) {
            maxSecCnaes = Math.max(maxSecCnaes, r.company.cnaes_secundarios.length);
        }
    });

    let header = "CNPJ;Razão Social;Nome Fantasia;Situação;Risco Calculado;Competência;CNAE Principal (Código);CNAE Principal (Descrição)";
    for (let i = 1; i <= maxSecCnaes; i++) {
        header += `;CNAE Secundário ${i} (Código);CNAE Secundário ${i} (Descrição)`;
    }
    header += "\n";

    let csvContent = header;
    results.forEach(r => {
        if (r.company && r.risk) {
            let row = [
                `"${r.company.cnpj}"`,
                `"${r.company.razao_social}"`,
                `"${r.company.nome_fantasia || ''}"`,
                `"${r.company.descricao_situacao_cadastral}"`,
                r.risk.riskLevel,
                r.risk.competence,
                `"${r.company.cnae_fiscal}"`,
                `"${r.company.cnae_fiscal_descricao}"`
            ].join(";");

            const secCnaes = r.company.cnaes_secundarios || [];
            for (let i = 0; i < maxSecCnaes; i++) {
                if (i < secCnaes.length) {
                    row += `;${secCnaes[i].codigo};"${secCnaes[i].descricao}"`;
                } else {
                    row += ";;"; 
                }
            }
            csvContent += row + "\n";
        }
    });

    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `lote_analise_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  reset() {
    this.navigate('dashboard');
    this.cnpjInput.set('');
    this.resetFields();
  }

  private resetFields() {
    this.companyData.set(null);
    this.riskResult.set(null);
    this.errorMessage.set(null);
    this.processNotes.set('');
    this.showAllCnaes.set(false);
    this.licenseStatus.set(undefined);
    this.licenseNumber.set('');
    this.licenseIssueDate.set('');
    this.licenseExpiryDate.set('');
    this.legalRepresentative.set('');
    this.technicalRepresentative.set('');
    this.userAnswers.set({}); 
  }

  exportCSV() {
    const data = this.companyData();
    const result = this.riskResult();
    if (!data || !result) return;
    let csvContent = "Razão Social;CNPJ;Classificação Geral;Competência;CNAE;Descrição da Atividade;Risco Individual;PBA Necessário;Observações\n";
    result.cnaeDetails.forEach(detail => {
      const officialDescription = this.getCnaeDescription(detail.code) || detail.sourceRule?.description || 'Descrição não disponível';
      const row = [`"${data.razao_social}"`, `"${data.cnpj}"`, result.riskLevel, result.competence, `"${detail.code}"`, `"${officialDescription}"`, detail.risk, detail.sourceRule?.requiresPba ? 'Sim' : 'Não', `"${this.processNotes().replace(/"/g, '""')}"`].join(";");
      csvContent += row + "\n";
    });
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `analise_risk_${data.cnpj}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  formatCnpj(value: string): string {
    const v = value.replace(/\D/g, '');
    if (v.length === 14) {
      return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
    }
    if (v.length === 11) {
      return v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
    }
    return value;
  }

  getCnaeDescription(code: string): string {
    const data = this.companyData();
    if (!data) return '';
    const cleanCode = String(code).replace(/\D/g, '');
    const cleanMain = String(data.cnae_fiscal).replace(/\D/g, '');
    if (cleanCode === cleanMain) {
      return data.cnae_fiscal_descricao;
    }
    const sec = data.cnaes_secundarios.find(s => String(s.codigo).replace(/\D/g, '') === cleanCode);
    return sec ? sec.descricao : '';
  }

  // Helper method missing in previous version
  getCnaeDescriptionFromCompanyData(code: string, company: Partial<CompanyData>): string {
    if (!company) return '';
    const cleanCode = String(code).replace(/\D/g, '');
    
    // Check main CNAE
    if (company.cnae_fiscal) {
       const cleanMain = String(company.cnae_fiscal).replace(/\D/g, '');
       if (cleanCode === cleanMain) {
         return company.cnae_fiscal_descricao || '';
       }
    }

    // Check secondary CNAEs
    if (company.cnaes_secundarios) {
      const sec = company.cnaes_secundarios.find(s => String(s.codigo).replace(/\D/g, '') === cleanCode);
      if (sec) return sec.descricao;
    }
    
    return '';
  }

  getRiskCardClass(level: string) {
    const base = "rounded-xl p-6 text-white shadow-lg transition-all border-l-8 ";
    if (this.riskResult()?.override) {
      return base + "bg-gradient-to-br from-purple-600 to-purple-700 border-purple-900";
    }
    switch (level) {
      case 'BAIXO': return base + "bg-gradient-to-br from-green-500 to-green-600 border-green-800";
      case 'MÉDIO': return base + "bg-gradient-to-br from-yellow-400 to-yellow-500 border-yellow-700 text-yellow-900";
      case 'ALTO': return base + "bg-gradient-to-br from-red-600 to-red-700 border-red-900";
      case 'CONDICIONADO': return base + "bg-gray-500 border-gray-700";
      case 'PENDENTE DE ANÁLISE': return base + "bg-slate-700 border-slate-900"; 
      default: return base + "bg-gray-500";
    }
  }

  getBadgeClass(risk: string) {
    const base = "px-2 py-1 rounded text-xs font-bold ";
    switch (risk) {
      case 'ALTO': return base + "bg-red-100 text-red-700";
      case 'MÉDIO': return base + "bg-yellow-100 text-yellow-800";
      case 'BAIXO': return base + "bg-green-100 text-green-700";
      case 'CONDICIONADO': return base + "bg-gray-200 text-gray-700";
      case 'INDEFINIDO': return base + "bg-orange-100 text-orange-800 border border-orange-200"; 
      default: return base + "bg-gray-100 text-gray-500";
    }
  }
  
  getLicenseStatusBadgeClass(status?: string) {
    const base = "px-2 py-1 rounded text-xs font-bold ";
    switch (status) {
      case 'Ativa': return base + "bg-green-100 text-green-700";
      case 'Vencida': return base + "bg-red-100 text-red-700";
      case 'Em Renovação': return base + "bg-yellow-100 text-yellow-800";
      case 'Suspensa': return base + "bg-orange-100 text-orange-800";
      case 'Pendente': return base + "bg-blue-100 text-blue-800";
      default: return base + "bg-gray-100 text-gray-500";
    }
  }

  normalizeRisk(risk: string): string {
    return risk.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  }

  getArgosBadgeClass(risk: string): string {
    const r = this.normalizeRisk(risk);
    if (r === 'MEDIO') return 'risk-MEDIO';
    if (r === 'BAIXO') return 'risk-BAIXO';
    if (r === 'ALTO') return 'risk-ALTO';
    if (r === 'CONDICIONADO' || r === 'COND') return 'risk-COND';
    if (r === 'INDEFINIDO') return 'risk-INDEFINIDO';
    return '';
  }

  getProcedimentoText(risk: string): string {
    if (risk === 'ALTO') {
        return "O estabelecimento está enquadrado como <strong>ALTO RISCO</strong>, exigindo <strong>INSPEÇÃO PRÉVIA OBRIGATÓRIA</strong> e aprovação de Projeto Básico de Arquitetura (PBA) para emissão de licença sanitária, conforme Art. 13 da Resolução SESA/PR nº 1034/2020.";
    } else if (risk === 'MÉDIO') {
        return "O estabelecimento está enquadrado como <strong>MÉDIO RISCO</strong>, sendo passível de <strong>LICENCIAMENTO SIMPLIFICADO</strong> mediante declaração de responsabilidade técnica, nos termos do Art. 14 da Resolução SESA/PR nº 1034/2020. A inspeção sanitária será realizada <em>a posteriori</em>, conforme cronograma da Vigilância Sanitária Municipal.";
    } else if (risk === 'BAIXO') {
        return "O estabelecimento está enquadrado como <strong>BAIXO RISCO</strong>, sendo <strong>DISPENSADO DE ATO PÚBLICO DE LIBERAÇÃO</strong>, mantendo-se a obrigatoriedade do cumprimento das normas sanitárias vigentes, conforme Art. 15 da Resolução SESA/PR nº 1034/2020.";
    } else {
        return "<strong>ATENÇÃO:</strong> Classificação não definida automaticamente. O estabelecimento exerce atividades (CNAEs) que não constam no banco de dados da legislação municipal ou possuem condicionantes pendentes. É obrigatória a resolução das pendências acima.";
    }
  }

  getRecommendedAction(risk: string): string {
    if (risk === 'BAIXO') return 'Emitir Declaração de Dispensa Automática.\nEmpresa liberada para funcionamento imediato.';
    if (risk === 'MÉDIO') return 'Emitir Licença Sanitária Simplificada mediante Termo de Ciência e Responsabilidade.';
    if (risk === 'ALTO') return 'Agendar Inspeção Prévia Obrigatória. Aprovação de PBA necessária se houver obra.';
    if (risk === 'PENDENTE DE ANÁLISE') return 'BLOQUEIO DE SEGURANÇA: Classificação automática impossível. Existem pendências a serem resolvidas.';
    return 'Realizar análise individualizada.';
  }

  generateMissingCnaesReport() {
    const history = this.historyList();
    const foundCnaesMap = new Map<string, { code: string; description: string; foundIn: { cnpj: string; name: string } }>();

    for (const process of history) {
      if (process.riskAnalysis?.riskLevel === 'PENDENTE DE ANÁLISE') {
        const undefinedCnaes = process.riskAnalysis.cnaeDetails.filter(d => d.risk === 'INDEFINIDO');
        for (const detail of undefinedCnaes) {
          if (!foundCnaesMap.has(detail.code)) {
            const description = this.getCnaeDescriptionFromCompanyData(detail.code, process.company);
            foundCnaesMap.set(detail.code, {
              code: detail.code,
              description: description,
              foundIn: {
                cnpj: process.company.cnpj || '',
                name: process.company.razao_social || '',
              },
            });
          }
        }
      }
    }

    this.missingCnaes.set(Array.from(foundCnaesMap.values()));
    this.showMissingCnaesReport.set(true);
  }

  closeMissingCnaesReport() {
    this.showMissingCnaesReport.set(false);
  }

  exportMissingCnaesCSV() {
    const cnaes = this.missingCnaes();
    if (cnaes.length === 0) {
      alert('Nenhum dado para exportar.');
      return;
    }

    let csvContent = "CNAE;Descricao (ReceitaWS);Encontrado no CNPJ;Razao Social\n";
    
    cnaes.forEach(cnae => {
      const row = [
        `"${cnae.code}"`,
        `"${cnae.description.replace(/"/g, '""')}"`,
        `"${this.formatCnpj(cnae.foundIn.cnpj)}"`,
        `"${cnae.foundIn.name.replace(/"/g, '""')}"`
      ].join(";");
      csvContent += row + "\n";
    });

    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `relatorio_cnaes_pendentes_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  getCurrentDate() {
    return new Date().toLocaleDateString('pt-BR');
  }
  
  getDateTime() {
     return new Date().toLocaleString('pt-BR');
  }
  
  formatDate(isoString: string) {
    if (!isoString) return '';
    try {
      return new Date(isoString).toLocaleDateString('pt-BR') + ' ' + new Date(isoString).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
    } catch(e) {
      return isoString;
    }
  }

  formatJustDate(date: Date | null): string {
    if (!date) return '';
    try {
      return date.toLocaleDateString('pt-BR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC' // Avoid timezone issues
      });
    } catch (e) {
      return 'Data inválida';
    }
  }

  openArgosReportWindow() {
    const data = this.companyData();
    const risk = this.riskResult();

    if (!data || !risk) {
      alert('Dados insuficientes para gerar relatório.');
      return;
    }

    // Prepare table rows
    let cnaeRows = '';
    risk.cnaeDetails.forEach(item => {
        const riskClass = this.getArgosBadgeClass(item.risk);
        const pbaBadge = item.sourceRule?.requiresPba ? '• EXIGE PBA' : '';
        const source = item.sourceRule ? 'SESA 1034/2020' : (item.resolved ? 'DECISÃO MANUAL DO AGENTE' : (item.isFallback ? 'ANALOGIA (REGRA 1)' : 'Não catalogado'));
        const fallbackNote = item.isFallback ? '<div style="font-size: 6.5pt; color: #b45309; font-weight: 700; margin-top: 2px;">⚠ FALLBACK (REGRA 1)</div>' : '';
        
        cnaeRows += `
          <tr>
            <td><b>${item.code}</b></td>
            <td>${this.getCnaeDescription(item.code)}</td>
            <td style="text-align: center; font-size: 7pt;">${source}</td>
            <td>
              <span class="badge ${riskClass}">${item.risk}</span>
              ${fallbackNote}
              <div style="font-size: 7pt; color: #64748b; margin-top: 3px;">
                ${pbaBadge}
              </div>
            </td>
          </tr>
        `;
    });

    let overrideNote = risk.override ? 
       `<p style="font-size: 8pt; margin-top: 5px; color: #4b5563;">
          <strong>NOTA DE AUDITORIA:</strong> Classificação alterada manualmente de ${risk.override.originalRisk} para ${risk.override.manualRisk}.<br>
          Justificativa: ${risk.override.reason}
        </p>` : '';
        
    if (risk.observation) {
       overrideNote += `<p style="font-size: 8pt; margin-top: 5px; color: #b45309; font-weight: bold; border-top: 1px dashed #ccc; padding-top: 5px;">
          NOTA DO SISTEMA: ${risk.observation}
       </p>`;
    }

    const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Relatório Técnico ARGOS - ${data.razao_social}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');

    :root {
      --primary: #000000;
      --accent: #0f172a; 
      --page-bg: #cbd5e1;
      --paper: #ffffff;
      --page-width: 210mm;
      --page-height: 297mm;
      
      /* Cores de Risco Sanitário */
      --risk-baixo: #d4edda;
      --risk-baixo-text: #155724;
      --risk-medio: #fff3cd;
      --risk-medio-text: #856404;
      --risk-alto: #f8d7da;
      --risk-alto-text: #721c24;
      --risk-cond: #d1ecf1;
      --risk-cond-text: #0c5460;
      --risk-indefinido: #ffe4e6;
      --risk-indefinido-text: #9f1239;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Inter', sans-serif;
      background-color: var(--page-bg);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 0;
      color: #1e293b;
      -webkit-font-smoothing: antialiased;
    }

    .a4-page {
      width: var(--page-width);
      min-height: var(--page-height);
      background-color: var(--paper);
      padding: 15mm 20mm;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      position: relative;
      display: flex;
      flex-direction: column;
      margin-bottom: 30px;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid var(--primary);
      padding-bottom: 12px;
      margin-bottom: 25px;
    }

    .header-left { display: flex; align-items: center; gap: 15px; }
    .header-left img { height: 70px; width: auto; }
    .header-left .titles h1 { 
      font-size: 14pt; 
      font-weight: 900; 
      text-transform: uppercase; 
      line-height: 1.1;
    }
    .header-left .titles h2 { 
      font-size: 10pt; 
      font-weight: 500; 
      color: #334155; 
    }

    .header-right { text-align: right; }
    .header-right .sys-title { font-weight: 900; font-size: 16pt; color: var(--accent); letter-spacing: 1px; }
    .header-right .sys-sub { font-size: 7pt; text-transform: uppercase; color: #64748b; font-weight: 700; }

    .document-body {
      flex-grow: 1;
      font-size: 10pt;
      line-height: 1.4;
    }

    .report-banner {
      background-color: #f1f5f9;
      text-align: center;
      padding: 10px;
      border: 1px solid #e2e8f0;
      margin-bottom: 20px;
    }
    .report-banner h3 { font-size: 12pt; font-weight: 800; text-transform: uppercase; color: var(--accent); }
    .report-banner span { font-size: 8pt; font-style: italic; color: #64748b; }

    .section-header {
      font-weight: 800;
      text-transform: uppercase;
      font-size: 10pt;
      border-bottom: 1px solid var(--accent);
      margin: 15px 0 10px 0;
      padding-bottom: 3px;
      color: var(--accent);
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 10px;
      margin-bottom: 20px;
    }
    .field { display: flex; flex-direction: column; }
    .field label { font-size: 7pt; font-weight: 800; text-transform: uppercase; color: #64748b; margin-bottom: 2px; }
    .field .val { 
      font-size: 9.5pt; 
      font-weight: 600; 
      background: #f8fafc; 
      padding: 4px 8px; 
      border: 1px solid #e2e8f0;
      min-height: 24px;
    }

    table { width: 100%; border-collapse: collapse; margin-top: 5px; font-size: 9pt; }
    th { background: #f1f5f9; padding: 6px; border: 1px solid #cbd5e1; text-align: left; font-weight: 800; text-transform: uppercase; font-size: 8pt; }
    td { padding: 6px; border: 1px solid #cbd5e1; vertical-align: top; }

    .badge { padding: 2px 6px; border-radius: 4px; font-weight: 800; font-size: 7.5pt; text-transform: uppercase; display: inline-block; }
    .risk-BAIXO { background: var(--risk-baixo); color: var(--risk-baixo-text); border: 1px solid #c3e6cb; }
    .risk-MEDIO { background: var(--risk-medio); color: var(--risk-medio-text); border: 1px solid #ffeeba; }
    .risk-ALTO { background: var(--risk-alto); color: var(--risk-alto-text); border: 1px solid #f5c6cb; }
    .risk-COND { background: var(--risk-cond); color: var(--risk-cond-text); border: 1px solid #bee5eb; }
    .risk-INDEFINIDO { background: var(--risk-indefinido); color: var(--risk-indefinido-text); border: 1px solid #fecdd3; }

    .conclusion-box {
      border: 2px solid var(--accent);
      padding: 15px;
      margin-top: 20px;
      background: #fff;
    }
    .final-risk {
      text-align: center;
      font-size: 14pt;
      font-weight: 900;
      padding: 10px;
      margin: 10px 0;
      border: 1px dashed #94a3b8;
    }

    .sig-area { display: flex; justify-content: space-between; margin-top: 40px; }
    .sig-block { width: 45%; text-align: center; }
    .sig-line { border-top: 1px solid #000; margin-bottom: 5px; }
    .sig-name { font-weight: 800; font-size: 9pt; text-transform: uppercase; }
    .sig-sub { font-size: 8pt; color: #475569; }

    footer.screen-footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 7.5pt;
      color: #64748b;
      font-weight: 600;
      text-transform: uppercase;
      margin-top: auto;
    }

    .footer-left-brand img { height: 35px; width: auto; }

    .btn-print {
      position: fixed; bottom: 30px; right: 30px;
      background: var(--accent); color: white;
      border: none; padding: 15px 25px; border-radius: 12px;
      font-weight: 800; cursor: pointer; z-index: 1000;
      box-shadow: 0 10px 15px rgba(0,0,0,0.3);
      display: flex; align-items: center; gap: 10px;
    }

    @media print {
      body { background: white; padding: 0; }
      .a4-page { width: 100%; box-shadow: none; margin: 0; padding: 15mm; }
      .btn-print { display: none; }
      @page { size: A4; margin: 10mm; }
    }
  </style>
</head>
<body>

  <button class="btn-print" onclick="window.print()">
    <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2m-2 4H8v-4h8v4z"></path></svg>
    IMPRIMIR RELATÓRIO
  </button>

  <div class="a4-page">
    <header>
      <div class="header-left">
        <img src="https://i.postimg.cc/529vS7wJ/brasao-municipio.png" alt="Brasão">
        <div class="titles">
          <h1>Prefeitura Municipal de Perobal</h1>
          <h2>Diretoria de Vigilância em Saúde</h2>
        </div>
      </div>
      <div class="header-right">
        <div class="sys-title">ARGOS</div>
        <div class="sys-ver">Inteligência Territorial</div>
      </div>
    </header>

    <div class="document-body">
      <div class="report-banner">
        <h3>Relatório Técnico de Enquadramento Sanitário</h3>
        <span>Auditoria baseada em Resoluções Normativas Vigentes</span>
      </div>

      <div class="section-header">1. Identificação do Sujeito Passivo</div>
      <div class="info-grid">
        <div class="field" style="grid-column: span 8;">
          <label>Razão Social / Nome Empresarial</label>
          <div class="val">${data.razao_social}</div>
        </div>
        <div class="field" style="grid-column: span 4;">
          <label>CNPJ / CPF</label>
          <div class="val">${this.formatCnpj(data.cnpj)}</div>
        </div>
        <div class="field" style="grid-column: span 9;">
          <label>Logradouro / Endereço</label>
          <div class="val">${data.logradouro}, ${data.numero} - ${data.bairro}</div>
        </div>
        <div class="field" style="grid-column: span 3;">
          <label>Município / UF</label>
          <div class="val">PEROBAL / PR</div>
        </div>
      </div>

      <div class="section-header">2. Análise de Atividades Econômicas (CNAE)</div>
      <table>
        <thead>
          <tr>
            <th style="width: 12%;">CNAE</th>
            <th style="width: 48%;">Descrição da Atividade</th>
            <th style="width: 15%; text-align: center;">Origem</th>
            <th style="width: 25%;">Classificação de Risco</th>
          </tr>
        </thead>
        <tbody>
          ${cnaeRows}
        </tbody>
      </table>

      <div class="section-header">3. Parecer Técnico Conclusivo</div>
      <div class="conclusion-box">
        <p>Certificamos que, após análise automática das atividades econômicas e aplicação das Resoluções Normativas vigentes para o licenciamento sanitário, o estabelecimento classifica-se como:</p>
        
        <div class="final-risk" id="final-risk-id">
          ${risk.riskLevel}
        </div>

        <p style="font-size: 8pt; font-style: italic; border-top: 1px dotted #ccc; padding-top: 5px;">
           ${this.getProcedimentoText(risk.riskLevel)}
        </p>
        
        ${overrideNote}
      </div>

      <div class="sig-area">
        <div class="sig-block">
          <div class="sig-line"></div>
          <p class="sig-name">Responsável Legal</p>
          <p class="sig-sub">Declarante</p>
        </div>
        <div class="sig-block">
          <div class="sig-line"></div>
          <p class="sig-name">Rafael Amaro Silvério</p>
          <p class="sig-sub">Diretor de Vigilância em Saúde</p>
        </div>
      </div>
    </div>

    <footer class="screen-footer">
      <div class="footer-left-brand">
        <img src="https://i.ibb.co/4nPDxkqx/Logo-adminstr.png" alt="Logo Administração">
      </div>
      <span id="timestamp-dvs">DILIGÊNCIA ADMINISTRATIVA - ${this.getDateTime()}</span>
      <span>ARGOS PANOPTES - PÁGINA 1 DE 1</span>
    </footer>
  </div>

  <script>
    function updateRiskStyle() {
      const riskEl = document.getElementById('final-risk-id');
      const riskText = riskEl.innerText.trim();
      if(riskText.includes("ALTO")) { riskEl.style.color = "#991b1b"; riskEl.style.backgroundColor = "#fee2e2"; }
      else if(riskText.includes("MÉDIO") || riskText.includes("MEDIO") || riskText.includes("PENDENTE")) { riskEl.style.color = "#92400e"; riskEl.style.backgroundColor = "#fef3c7"; }
      else { riskEl.style.color = "#065f46"; riskEl.style.backgroundColor = "#d1fae5"; }
    }
    window.onload = updateRiskStyle;
  </script>
</body>
</html>
    `;

    const win = window.open('', '_blank');
    if (win) {
      win.document.write(htmlContent);
      win.document.close();
    } else {
      alert('Bloqueador de pop-ups detectado. Permita pop-ups para visualizar o relatório.');
    }
  }
}
