import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReportExportDto, ReportFiltersDto } from './reports.dto';

export interface ReportExport {
  fileName: string;
  contentType: string;
  contentBase64: string;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly config: ConfigService) {}

  dashboard(filters: ReportFiltersDto): Promise<unknown> {
    return this.request('/dashboard', filters);
  }

  async export(filters: ReportExportDto): Promise<ReportExport> {
    const response = await this.requestResponse('/export', filters);
    const contentDisposition = response.headers.get('content-disposition') ?? '';
    const fileName = /filename="([^"]+)"/i.exec(contentDisposition)?.[1];
    if (!fileName) {
      throw new BadGatewayException('El servicio de informes devolvió un archivo sin nombre.');
    }
    return {
      fileName,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      contentBase64: Buffer.from(await response.arrayBuffer()).toString('base64'),
    };
  }

  private async request(path: string, filters: ReportFiltersDto): Promise<unknown> {
    const response = await this.requestResponse(path, filters);
    try {
      return await response.json();
    } catch {
      throw new BadGatewayException('El servicio de informes devolvió una respuesta inválida.');
    }
  }

  private async requestResponse(path: string, filters: ReportFiltersDto): Promise<Response> {
    const token = this.config.get<string>('REPORTS_SERVICE_TOKEN')?.trim();
    if (!token) {
      throw new ServiceUnavailableException(
        'El acceso interno al servicio de informes no está configurado.',
      );
    }
    const baseUrl = this.config.get<string>('REPORTS_URL', 'http://localhost:8000');
    let url: URL;
    try {
      url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    } catch {
      throw new ServiceUnavailableException('La dirección del servicio de informes no es válida.');
    }
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo contactar con el servicio de informes: ${
          error instanceof Error ? error.name : 'error desconocido'
        }.`,
      );
      throw new ServiceUnavailableException('El servicio de informes no está disponible.');
    }
    if (!response.ok) {
      if (response.status === 422) {
        let message = 'Los filtros del informe no son válidos.';
        try {
          const body: unknown = await response.json();
          if (typeof body === 'object' && body !== null && 'detail' in body) {
            const detail = (body as { detail: unknown }).detail;
            if (typeof detail === 'string') message = detail;
          }
        } catch {
          // Mantiene el error de validación explícito sin exponer respuestas inesperadas.
        }
        throw new BadGatewayException(message);
      }
      this.logger.warn(`El servicio de informes respondió HTTP ${response.status}.`);
      throw new ServiceUnavailableException('No se pudo generar el informe.');
    }
    return response;
  }
}
