import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Apuestas Deportivas',
  description: 'Sistema web de apuestas deportivas — proyecto académico UTPL',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
