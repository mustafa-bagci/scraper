import 'server-only';
import { prisma } from '@/lib/db/prisma';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMAS,
  SettingKey,
} from '@/types/settings';

/**
 * Settings are stored one row per section in `Setting`. Reads always fall back
 * to the defaults and re-validate, so a malformed or partial row can never
 * crash a request.
 */
export async function getSettings(): Promise<AppSettings> {
  const rows = await prisma.setting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  return {
    general: resolveSection('general', byKey.get('general')),
    scoring: resolveSection('scoring', byKey.get('scoring')),
    reviews: resolveSection('reviews', byKey.get('reviews')),
    crawler: resolveSection('crawler', byKey.get('crawler')),
    limits: resolveSection('limits', byKey.get('limits')),
    export: resolveSection('export', byKey.get('export')),
    security: resolveSection('security', byKey.get('security')),
  };
}

export async function getSetting<K extends SettingKey>(key: K): Promise<AppSettings[K]> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return resolveSection(key, row?.value);
}

export async function updateSetting<K extends SettingKey>(
  key: K,
  value: unknown,
): Promise<AppSettings[K]> {
  const schema = SETTINGS_SCHEMAS[key];
  const parsed = schema.parse(value) as AppSettings[K];
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: parsed as object },
    update: { value: parsed as object },
  });
  return parsed;
}

export async function resetSetting<K extends SettingKey>(key: K): Promise<AppSettings[K]> {
  await prisma.setting.deleteMany({ where: { key } });
  return DEFAULT_SETTINGS[key];
}

function resolveSection<K extends SettingKey>(key: K, raw: unknown): AppSettings[K] {
  if (raw === undefined || raw === null) return DEFAULT_SETTINGS[key];
  const parsed = SETTINGS_SCHEMAS[key].safeParse(raw);
  return (parsed.success ? parsed.data : DEFAULT_SETTINGS[key]) as AppSettings[K];
}
