import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CNAE_LIST, CnaeRuleData } from '../data/cnae-db';
import { supabase } from '../supabase-client';

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
  private readonly RULES_TABLE = 'cnae_rules';
  private rulesMap = new Map<string, CnaeRule>();
  private rulesLoaded = signal(false);

  public cnaeRulesCount = computed(() => this.rulesMap.size);

  constructor() {
    // A inicialização agora é assíncrona e deve ser chamada externamente.
  }

  private normalizeCnae(cnae: string): string {
    return String(cnae).replace(/[^\d]/g, '');
  }
  
  async initialize(): Promise<void> {
    if (this.rulesLoaded()) {
      return;
    }

    try {
      console.log('Buscando regras de CNAE do Supabase...');
      const { data, error } = await supabase.from(this.RULES_TABLE).select('*');
      
      if (error) {
        throw error;
      }

      if (data && data.length > 0) {
        this.rulesMap.clear();
        data.forEach((rule: CnaeRule) => {
          const cleanKey = this.normalizeCnae(rule.cnae);
          if (cleanKey) {
            this.rulesMap.set(cleanKey, rule);
          }
        });
        console.log(`Supabase: ${this.rulesMap.size} regras carregadas e indexadas.`);
      } else {
        console.warn('Nenhuma regra encontrada no Supabase, usando fallback local.');
        this.loadFromLocalFallback();
        // Opcional: Tentar enviar as regras locais para o Supabase se a tabela estiver vazia
        await this.seedSupabaseIfNeeded();
      }

      this.rulesLoaded.set(true);

    } catch (error) {
      console.error('Falha ao carregar regras do Supabase. Usando fallback local.', error);
      this.loadFromLocalFallback();
    }
  }

  private loadFromLocalFallback(): void {
    this.rulesMap.clear();
    CNAE_LIST.forEach(rule => {
      const cleanKey = this.normalizeCnae(rule.cnae);
      if (cleanKey) this.rulesMap.set(cleanKey, rule);
    });
    console.log(`Fallback: ${this.rulesMap.size} regras carregadas do arquivo local.`);
    this.rulesLoaded.set(true);
  }

  private async seedSupabaseIfNeeded(): Promise<void> {
    try {
      const { error } = await supabase.from(this.RULES_TABLE).insert(CNAE_LIST);
      if (error) {
        console.error('Falha ao tentar popular o Supabase com as regras locais.', error);
      } else {
        console.log('Supabase populado com sucesso a partir do fallback local.');
      }
    } catch (e) {
      console.error('Exceção ao popular o Supabase.', e);
    }
  }

  public async saveRule(rule: CnaeRule): Promise<void> {
    const cleanKey = this.normalizeCnae(rule.cnae);
    if (!cleanKey) return;
    
    const { error } = await supabase.from(this.RULES_TABLE).upsert(rule, { onConflict: 'cnae' });
    if (error) {
      console.error('Falha ao salvar regra no Supabase', error);
      throw error;
    }
    
    // Atualiza o mapa local para consistência imediata
    this.rulesMap.set(cleanKey, rule);
  }

  public async deleteRule(cnaeCode: string): Promise<void> {
    const cleanKey = this.normalizeCnae(cnaeCode);
    const { error } = await supabase.from(this.RULES_TABLE).delete().eq('cnae', cleanKey);

    if(error) {
      console.error('Falha ao deletar regra no Supabase', error);
      throw error;
    }

    if (this.rulesMap.has(cleanKey)) {
      this.rulesMap.delete(cleanKey);
    }
  }

  public getAllRules(): CnaeRule[] {
    return Array.from(this.rulesMap.values()).sort((a, b) => a.cnae.localeCompare(b.cnae));
  }

  private getCnaeRule(code: string): CnaeRule | undefined {
    const cleanCode = this.normalizeCnae(code);
    return this.rulesMap.get(cleanCode);
  }

  async analyze(cnaes: (string | {codigo: string})[], userAnswers: Record<string, RiskLevel> = {}): Promise<RiskAnalysisResult> {
    if (!this.rulesLoaded()) {
      await this.initialize();
    }

    let highestRisk: RiskLevel = 'BAIXO';
    let hasStateCompetence = false;
    let requiresPba = false;
    let hasFallback = false;
    
    const details: any[] = [];
    const pendingResolutions: PendingResolution[] = [];

    for (const cnaeItem of cnaes) {
      const rawCode = typeof cnaeItem === 'string' ? cnaeItem : cnaeItem.codigo;
      const cleanCode = this.normalizeCnae(rawCode);
      
      if (!cleanCode || /^0+$/.test(cleanCode)) {
        continue;
      }

      const rule = this.rulesMap.get(cleanCode);
      
      let risk: RiskLevel = 'BAIXO'; 
      let isResolved = false;
      let isFallback = false;
      let description = '';

      if (userAnswers[cleanCode]) {
        risk = userAnswers[cleanCode];
        isResolved = true;
        description = rule?.description || 'Classificação Manual';
        
        if (rule) {
           if (rule.requiresPba) requiresPba = true;
           if (rule.competencePorte1 === 'ESTADO') hasStateCompetence = true;
        }
      } 
      else if (rule) {
        description = rule.description;
        
        if (rule.risk === 'CONDICIONADO') {
          risk = 'CONDICIONADO';
          pendingResolutions.push({
            cnae: rawCode,
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
      else {
        risk = 'MÉDIO';
        isFallback = true;
        hasFallback = true;
        description = 'Atividade não catalogada (Classificação por Analogia)';
      }

      details.push({ 
        code: rawCode,
        risk, 
        sourceRule: rule, 
        resolved: isResolved, 
        isFallback,
        description 
      });

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
