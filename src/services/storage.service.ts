import { Injectable } from '@angular/core';
import { CompanyData } from './cnpj.service';
import { RiskAnalysisResult, RiskLevel } from './risk.service';
import { supabase } from '../supabase-client';

export interface SavedProcess {
  id: string; // CNPJ or CPF
  company: Partial<CompanyData>; // Can be partial for legacy data
  riskAnalysis: RiskAnalysisResult;
  timestamp: string;
  notes?: string;
  isLegacy?: boolean;
  licenseStatus?: 'Ativa' | 'Vencida' | 'Em Renovação' | 'Suspensa' | 'Pendente';
  licenseNumber?: string;
  licenseIssueDate?: string; // YYYY-MM-DD
  licenseExpiryDate?: string; // YYYY-MM-DD
  legalRepresentative?: string;
  technicalRepresentative?: string;
  cnesNumber?: string;
  userAnswers?: Record<string, RiskLevel>; // Stores Yes/No answers for conditional risks
}

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private readonly PROCESSES_TABLE = 'processes';

  async initializeLegacyData(legacyData: any[]): Promise<void> {
    try {
      const { count } = await supabase.from(this.PROCESSES_TABLE).select('*', { count: 'exact', head: true });

      if (count === 0) {
        console.log('Banco de dados vazio, populando com dados legados...');
        const placeholderRiskAnalysis: RiskAnalysisResult = {
          riskLevel: 'PENDENTE DE ANÁLISE',
          competence: 'ANÁLISE MANUAL',
          requiresPba: false,
          cnaeDetails: [],
          pendingResolutions: []
        };

        const legacyProcesses: SavedProcess[] = legacyData
          .map((item): SavedProcess | null => {
            const id = (item.cnpj || '').replace(/\D/g, '');
            if (id.length !== 14 && id.length !== 11) {
              return null;
            }

            return {
              id: id,
              company: {
                cnpj: id,
                razao_social: item.razao_social,
              },
              riskAnalysis: placeholderRiskAnalysis,
              timestamp: new Date().toISOString(),
              notes: 'Registro importado do sistema legado. Requer análise completa.',
              isLegacy: true,
              licenseStatus: 'Pendente',
            };
          })
          .filter((item): item is SavedProcess => item !== null);

        const { error } = await supabase.from(this.PROCESSES_TABLE).insert(legacyProcesses);
        if (error) {
          console.error('Erro ao inserir dados legados no Supabase:', error);
        } else {
          console.log(`${legacyProcesses.length} registros legados inseridos com sucesso.`);
        }
      } else {
        console.log('Banco de dados já contém dados. Nenhuma ação de inicialização necessária.');
      }
    } catch (error) {
      console.error("Falha ao inicializar dados legados:", error);
    }
  }

  async save(process: SavedProcess): Promise<void> {
    const { error } = await supabase.from(this.PROCESSES_TABLE).upsert(process, { onConflict: 'id' });
    if (error) {
      console.error('Erro ao salvar processo:', error);
      throw error;
    }
  }

  async getAll(): Promise<SavedProcess[]> {
    const { data, error } = await supabase
      .from(this.PROCESSES_TABLE)
      .select('*')
      .order('timestamp', { ascending: false });

    if (error) {
      console.error('Erro ao buscar todos os processos:', error);
      return [];
    }
    return data || [];
  }

  async delete(cnpj: string): Promise<void> {
    const { error } = await supabase.from(this.PROCESSES_TABLE).delete().eq('id', cnpj);
    if (error) {
      console.error('Erro ao deletar processo:', error);
      throw error;
    }
  }

  async get(cnpj: string): Promise<SavedProcess | undefined> {
    const { data, error } = await supabase
      .from(this.PROCESSES_TABLE)
      .select('*')
      .eq('id', cnpj)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = 'No rows found'
      console.error('Erro ao buscar processo:', error);
    }
    return data || undefined;
  }
}
