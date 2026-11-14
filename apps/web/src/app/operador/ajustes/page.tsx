'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { fromCents, toCents, UserRole } from '@apuestas/shared';
import { AppShell } from '@/components/AppShell';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';
import styles from './ajustes.module.css';

interface Setting {
  key: string;
  value: number;
  default: number;
  min: number;
  max: number;
  description: string;
}

/** Cómo se edita cada ajuste: la API guarda centavos, centésimas y milisegundos. */
type Unit = 'usd' | 'odds' | 'seconds' | 'hours' | 'number';

const UNIT_OF: Record<string, Unit> = {
  'limits.minStake': 'usd',
  'limits.maxStake': 'usd',
  'limits.maxPayout': 'usd',
  'limits.dailyStakePerUser': 'usd',
  'fraud.anomalousStakeMin': 'usd',
  'bonus.minOdds': 'odds',
  'live.delayMs': 'seconds',
  'suspension.windowMs': 'hours',
};

const GROUPS: { prefix: string; title: string }[] = [
  { prefix: 'limits.', title: 'Límites de apuesta' },
  { prefix: 'combo.', title: 'Combinadas' },
  { prefix: 'live.', title: 'Apuestas en vivo' },
  { prefix: 'suspension.', title: 'Partidos suspendidos y aplazados' },
  { prefix: 'bonus.', title: 'Bonos' },
  { prefix: 'fraud.', title: 'Detección de fraude' },
];

const SUFFIX: Record<Unit, string> = {
  usd: 'USD',
  odds: '',
  seconds: 's',
  hours: 'h',
  number: '',
};

function toDisplay(unit: Unit, value: number): string {
  switch (unit) {
    case 'usd':
    case 'odds':
      return fromCents(value);
    case 'seconds':
      return String(value / 1000);
    case 'hours':
      return String(value / 3_600_000);
    default:
      return String(value);
  }
}

/** Convierte lo escrito al valor que guarda la API; null si no es válido. */
function fromDisplay(unit: Unit, text: string): number | null {
  const value = text.trim().replace(',', '.');
  try {
    switch (unit) {
      case 'usd':
      case 'odds':
        return toCents(value);
      case 'seconds': {
        const n = Number(value);
        return value !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : null;
      }
      case 'hours': {
        const n = Number(value);
        return value !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 3_600_000) : null;
      }
      default:
        return /^\d+$/.test(value) ? Number(value) : null;
    }
  } catch {
    return null;
  }
}

function Settings() {
  const [settings, setSettings] = useState<Setting[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setSettings(await api<Setting[]>('/operator/settings'));
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={styles.page}>
      <div className="stack">
        <h1>Ajustes de apuestas</h1>
        <p className="muted">
          Cada cambio aplica a la siguiente apuesta y queda registrado en la auditoría con el valor
          anterior.
        </p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {settings === null && !error && <p role="status">Cargando ajustes…</p>}
      {settings &&
        GROUPS.map((group) => {
          const items = settings.filter((s) => s.key.startsWith(group.prefix));
          if (items.length === 0) return null;
          return (
            <section key={group.prefix} className={styles.group} aria-label={group.title}>
              <h2>{group.title}</h2>
              {items.map((s) => (
                <SettingRow key={s.key} setting={s} onSaved={load} />
              ))}
            </section>
          );
        })}
    </div>
  );
}

function SettingRow({ setting, onSaved }: { setting: Setting; onSaved: () => void }) {
  const id = useId();
  const unit = UNIT_OF[setting.key] ?? 'number';
  const [text, setText] = useState(toDisplay(unit, setting.value));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setText(toDisplay(unit, setting.value));
  }, [unit, setting.value]);

  const parsed = fromDisplay(unit, text);
  const changed = parsed !== null && parsed !== setting.value;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (parsed === null) {
      setMessage({ tone: 'error', text: 'Escribe un número válido.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api(`/operator/settings/${setting.key}`, { method: 'PUT', body: { value: parsed } });
      setMessage({ tone: 'info', text: 'Guardado.' });
      onSaved();
    } catch (e) {
      setMessage({ tone: 'error', text: messageOf(e) });
    } finally {
      setSaving(false);
    }
  }

  const description = setting.description.replace(/\s*\((centavos|centésimas|ms)\)/, '');

  return (
    <form className={styles.row} onSubmit={save}>
      <label htmlFor={id} className={styles.label}>
        {description}
      </label>
      <div className={styles.control}>
        <input
          id={id}
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={parsed === null ? true : undefined}
          aria-describedby={`${id}-hint`}
        />
        {SUFFIX[unit] && <span className={styles.suffix}>{SUFFIX[unit]}</span>}
        <button type="submit" className="button" disabled={saving || !changed}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      <span id={`${id}-hint`} className="hint muted">
        Por defecto {toDisplay(unit, setting.default)} {SUFFIX[unit]}
      </span>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </form>
  );
}

export default function SettingsPage() {
  return (
    <AppShell roles={[UserRole.OPERATOR, UserRole.ADMIN]}>
      <Settings />
    </AppShell>
  );
}
