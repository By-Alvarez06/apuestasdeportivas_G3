import type { MailMessage } from '../mail/mail.service';

export const verificationMail = (to: string, link: string): MailMessage => ({
  to,
  subject: 'Confirma tu correo',
  text: `Hola:\n\nPara activar tu cuenta abre este enlace (vence en 24 horas):\n${link}\n\nSi no creaste una cuenta, ignora este correo.`,
});

export const duplicateRegistrationMail = (to: string, loginUrl: string): MailMessage => ({
  to,
  subject: 'Alguien intentó registrarse con tu correo',
  text: `Hola:\n\nAlguien intentó crear una cuenta con este correo, que ya está registrado. Si fuiste tú, inicia sesión en ${loginUrl}. Si no, no tienes que hacer nada: tu cuenta sigue igual.`,
});

export const passwordResetMail = (to: string, link: string): MailMessage => ({
  to,
  subject: 'Restablece tu contraseña',
  text: `Hola:\n\nPara elegir una contraseña nueva abre este enlace (vence en 1 hora):\n${link}\n\nAl cambiarla se cerrarán todas tus sesiones. Si no lo pediste, ignora este correo.`,
});

export const accountLockedMail = (to: string): MailMessage => ({
  to,
  subject: 'Tu cuenta se bloqueó temporalmente',
  text: 'Hola:\n\nHubo 5 intentos fallidos de iniciar sesión en tu cuenta, así que la bloqueamos 15 minutos. Si no fuiste tú, cambia tu contraseña cuando se desbloquee.',
});
