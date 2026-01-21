
import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CNAE_LIST, CnaeRuleData } from '../data/cnae-db';

export type CnaeRule = CnaeRuleData;

export type RiskLevel = 'BAIXO' | 'MÉDIO' | 'ALTO' | 'CONDICIONADO' | 'INDEFINIDO' | 'PENDENTE DE ANÁLISE';

export interface PendingResolution {
  cnae: string;
  description: string;
  type: 'CONDITION'; 
  question: string;
  rule: CnaeRule;
}

export interface RiskAnalysisResult {
  riskLevel: RiskLevel;
  competence: 'MUNICÍPIO' | 'ESTADO' | 'ANÁLISE MANUAL';
  requiresPba: boolean;
  cnaeDetails: { 
    code: string; 
    risk: string; 
    sourceRule?: CnaeRule; 
    resolved?: boolean;
    isFallback?: boolean; // Indica se foi aplicada a regra de analogia (CNAE desconhecido)
    description?: string;
  }[];
  pendingResolutions: PendingResolution[]; 
  override?: {
    originalRisk: RiskLevel;
    manualRisk: RiskLevel;
    reason: string;
  };
  observation?: string;
}

@Injectable({
  providedIn: 'root'
})
export class RiskService {
  private http = inject(HttpClient);
  // Mapa otimizado: Chave = CNAE apenas números, Valor = Regra
  private rulesMap = new Map<string, CnaeRule>();
  private rulesLoaded = signal(false);

  public cnaeRulesCount = computed(() => this.rulesMap.size);

  constructor() {
    this.initRules();
  }

  private normalizeCnae(cnae: string): string {
    // Remove tudo que não for dígito
    return String(cnae).replace(/[^\d]/g, '');
  }

  private initRules(): void {
    try {
      this.rulesMap.clear();
      CNAE_LIST.forEach(rule => {
        // Normaliza a chave ao carregar para garantir o match
        const cleanKey = this.normalizeCnae(rule.cnae);
        if (cleanKey) {
          this.rulesMap.set(cleanKey, rule);
        }
      });
      
      this.rulesLoaded.set(true);
      console.log(`Regras carregadas e indexadas: ${this.rulesMap.size}`);
    } catch (error) {
      console.error('Falha ao carregar as regras de CNAE do arquivo estático.', error);
    }
  }

  // Returns all rules as an array for display purposes
  public getAllRules(): CnaeRule[] {
    return Array.from(this.rulesMap.values());
  }

  private getCnaeRule(code: string): CnaeRule | undefined {
    const cleanCode = this.normalizeCnae(code);
    return this.rulesMap.get(cleanCode);
  }

  /**
   * Analisa CNAEs com normalização rigorosa e Fallback Automático (Regra 1).
   */
  async analyze(cnaes: string[], userAnswers: Record<string, RiskLevel> = {}): Promise<RiskAnalysisResult> {
    if (!this.rulesLoaded()) {
      this.initRules();
    }

    let highestRisk: RiskLevel = 'BAIXO';
    let hasStateCompetence = false;
    let requiresPba = false;
    let hasFallback = false;
    
    const details: any[] = [];
    const pendingResolutions: PendingResolution[] = [];

    for (const rawCode of cnaes) {
      // Normaliza para busca (remove pontuação)
      const cleanCode = this.normalizeCnae(rawCode);
      const rule = this.rulesMap.get(cleanCode);
      
      let risk: RiskLevel = 'BAIXO'; 
      let isResolved = false;
      let isFallback = false;
      let description = '';

      // 1. Verifica Respostas do Usuário (Se for um condicionado já respondido)
      if (userAnswers[cleanCode]) {
        risk = userAnswers[cleanCode];
        isResolved = true;
        description = rule?.description || 'Classificação Manual';
        
        if (rule) {
           if (rule.requiresPba) requiresPba = true;
           if (rule.competencePorte1 === 'ESTADO') hasStateCompetence = true;
        }
      } 
      // 2. Regra Existente na Base
      else if (rule) {
        description = rule.description;
        
        if (rule.risk === 'CONDICIONADO') {
          risk = 'CONDICIONADO';
          pendingResolutions.push({
            cnae: rawCode, // Mantém formatação original visual
            description: rule.description,
            type: 'CONDITION',
            question: rule.question || 'Esta atividade possui condições específicas. O risco é Alto?',
            rule: rule
          });
        } else {
          risk = rule.risk;
          if (rule.competencePorte1 === 'ESTADO') hasStateCompetence = true;
          if (rule.requiresPba) requiresPba = true;
        }
      } 
      // 3. FALLBACK AUTOMÁTICO (Regra 1: Analogia)
      // Se não achou regra, define como MÉDIO automaticamente, sem perguntar.
      else {
        risk = 'MÉDIO';
        isFallback = true;
        hasFallback = true;
        description = 'Atividade não catalogada (Classificação por Analogia)';
        // Assume competência Municipal no fallback
      }

      details.push({ 
        code: rawCode, // Exibe o código original
        risk, 
        sourceRule: rule, 
        resolved: isResolved, 
        isFallback,
        description 
      });

      // Cálculo de Risco Máximo
      if (risk === 'ALTO') highestRisk = 'ALTO';
      else if (risk === 'CONDICIONADO' && highestRisk !== 'ALTO') highestRisk = 'CONDICIONADO';
      else if (risk === 'MÉDIO' && highestRisk !== 'ALTO' && highestRisk !== 'CONDICIONADO') highestRisk = 'MÉDIO';
    }

    if (pendingResolutions.length > 0) {
      return {
        riskLevel: 'PENDENTE DE ANÁLISE',
        competence: 'ANÁLISE MANUAL',
        requiresPba: requiresPba, 
        cnaeDetails: details,
        pendingResolutions,
        observation: 'Necessário responder questionário de atividades condicionadas.'
      };
    }

    let finalObservation = "Classificação automática via Regra SESA 1034/2020.";
    if (hasFallback) {
      finalObservation = "Classificação contém itens por analogia (Fallback: Médio). Verifique se necessário.";
    }

    return {
      riskLevel: highestRisk,
      competence: hasStateCompetence ? 'ESTADO' : 'MUNICÍPIO',
      requiresPba,
      cnaeDetails: details,
      pendingResolutions: [],
      observation: finalObservation
    };
  }
}
