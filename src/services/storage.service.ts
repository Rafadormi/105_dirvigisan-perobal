
import { Injectable } from '@angular/core';
import { CompanyData } from './cnpj.service';
import { RiskAnalysisResult, RiskLevel } from './risk.service';

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
  userAnswers?: Record<string, RiskLevel>; // Stores Yes/No answers for conditional risks
}

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private readonly STORAGE_KEY = 'dirvigisan_history_v1';

  initializeLegacyData(legacyData: any[]): void {
    // Only initialize if the storage is empty
    if (localStorage.getItem(this.STORAGE_KEY)) {
      return;
    }

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

    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(legacyProcesses));
  }

  save(process: SavedProcess): void {
    const history = this.getAll();
    // Update if exists or add new
    const index = history.findIndex(p => p.id === process.id);
    if (index >= 0) {
      history[index] = process;
    } else {
      history.unshift(process);
    }
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
  }

  getAll(): SavedProcess[] {
    const data = localStorage.getItem(this.STORAGE_KEY);
    const processes: SavedProcess[] = data ? JSON.parse(data) : [];
    // Sort by date, newest first
    return processes.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  delete(cnpj: string): void {
    const history = this.getAll().filter(p => p.id !== cnpj);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
  }

  get(cnpj: string): SavedProcess | undefined {
    return this.getAll().find(p => p.id === cnpj);
  }
}
