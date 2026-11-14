import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Envío de correo por SMTP (Mailpit en desarrollo). Las pruebas lo reemplazan por una bandeja en memoria. */
@Injectable()
export class MailService {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.transport = createTransport(config.get<string>('SMTP_URL', 'smtp://localhost:1025'));
    this.from = config.get<string>('MAIL_FROM', 'Apuestas Deportivas <no-reply@apuestas.local>');
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}
