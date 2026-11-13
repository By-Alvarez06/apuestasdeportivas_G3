/**
 * Ruta interna a la que volver tras iniciar sesión, o null. Se juzga la URL ya normalizada por el
 * navegador: `/\evil.com` o `//evil.com` parecen rutas pero llevan a otro sitio (redirección abierta).
 */
export function safeReturn(value: string | null, origin = window.location.origin): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}
