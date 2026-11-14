/** Aviso con rol accesible: los errores se anuncian al instante, el resto con cortesía. */
export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error' | 'warning';
  children: React.ReactNode;
}) {
  return (
    <div className="notice" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
