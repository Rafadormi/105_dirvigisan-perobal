
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of, map, throwError } from 'rxjs';

export interface CompanyData {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  descricao_situacao_cadastral: string;
  municipio: string;
  uf: string;
  logradouro: string;
  numero: string;
  bairro: string;
  cnae_fiscal: string; // Main CNAE
  cnae_fiscal_descricao: string;
  cnaes_secundarios: { codigo: string; descricao: string }[];
  fetchedAt: string; // Data e hora exata da obtenção do dado
}

export interface TokenValidationResult {
  isValid: boolean;
  message: string;
  expiresAt?: Date | null;
  apiName: string;
}

@Injectable({
  providedIn: 'root'
})
export class CnpjService {
  private http = inject(HttpClient);
  // O token é mantido no storage pelo app.component, mas para a API PÚBLICA via JSONP,
  // ele não é enviado nos headers (JSONP não suporta headers customizados).

  /**
   * Busca dados da empresa usando ReceitaWS via JSONP (API Pública)
   * Isso evita erros de CORS que ocorrem com requisições HTTP normais no navegador.
   */
  fetchCompany(cnpj: string): Observable<CompanyData> {
    const cleanCnpj = cnpj.replace(/\D/g, '');
    const url = `https://receitaws.com.br/v1/cnpj/${cleanCnpj}`;

    // Usamos JSONP para evitar bloqueio CORS (Cross-Origin Resource Sharing)
    return this.http.jsonp<any>(url, 'callback').pipe(
      map(data => {
        if (data.status === 'ERROR') {
          throw new Error(data.message || 'CNPJ não encontrado ou inválido.');
        }
        
        return {
          cnpj: data.cnpj.replace(/\D/g, ''),
          razao_social: data.nome,
          nome_fantasia: data.fantasia,
          descricao_situacao_cadastral: data.situacao,
          municipio: data.municipio,
          uf: data.uf,
          logradouro: data.logradouro,
          numero: data.numero,
          bairro: data.bairro,
          cnae_fiscal: String(data.atividade_principal?.[0]?.code || '').replace(/\D/g, ''),
          cnae_fiscal_descricao: data.atividade_principal?.[0]?.text || '',
          cnaes_secundarios: (data.atividades_secundarias || [])
            .map((item: any) => ({
              codigo: String(item.code).replace(/\D/g, ''),
              descricao: item.text
            }))
            .filter((item: any) => {
              // Filter out invalid or placeholder CNAEs often returned by API when empty
              const code = item.codigo;
              return code && code !== '0000000' && code !== '00000000' && item.descricao !== 'Não informada';
            }),
          fetchedAt: new Date().toISOString()
        } as CompanyData;
      }),
      catchError((err) => {
        let errorMessage = 'Falha na comunicação com a API (JSONP).';
        
        // Erros de JSONP geralmente são genéricos (falha de script load)
        if (err instanceof Error) {
            errorMessage = err.message;
        } else if (typeof err === 'string') {
            errorMessage = err;
        } else {
             // Caso o erro seja um objeto Event ou similar que resultava em [object Object]
             // Na API Pública, isso geralmente significa Timeout ou Rate Limit (429) que o JSONP interpreta como erro de script.
             errorMessage = 'Conexão falhou. Aguarde o intervalo de segurança (1 consulta a cada 28s).';
        }

        console.warn('ReceitaWS JSONP Error:', errorMessage);
        return throwError(() => new Error(errorMessage));
      })
    );
  }

  /**
   * Verifica conectividade com a API ReceitaWS.
   * Como estamos usando JSONP (API Pública), não validamos o token comercial via Headers.
   */
  checkReceitaWsTokenValidity(token: string): Observable<TokenValidationResult> {
    // Teste com CNPJ do Banco do Brasil
    // Nota: Consome 1 quota das 3 permitidas por minuto.
    const url = `https://receitaws.com.br/v1/cnpj/00000000000191`;
    
    return this.http.jsonp<any>(url, 'callback').pipe(
      map(data => {
        if (data && data.status === 'OK') {
           return {
             isValid: true,
             message: 'Conexão Ativa. Respeite o intervalo de 28s entre consultas.',
             expiresAt: null,
             apiName: 'API ReceitaWS'
           };
        }
        return {
          isValid: false,
          message: 'API retornou erro inesperado.',
          expiresAt: null,
          apiName: 'API ReceitaWS'
        };
      }),
      catchError((err) => {
        return of({
          isValid: false,
          message: 'Falha de conexão. Aguarde 28s e tente novamente.',
          expiresAt: null,
          apiName: 'API ReceitaWS'
        });
      })
    );
  }
}
