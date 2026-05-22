import { getVoiceBundle, getVoiceSystemText, resolveVoiceLocale } from '../../../locales/voice/index.js';

describe('voice i18n loader', () => {
  it('resolves locale aliases and falls back to en-US', () => {
    expect(resolveVoiceLocale('es')).toBe('es-ES');
    expect(resolveVoiceLocale('es-MX')).toBe('es-ES');
    expect(resolveVoiceLocale('en')).toBe('en-US');
    expect(resolveVoiceLocale(undefined)).toBe('en-US');
  });

  it('provides flattened system texts', () => {
    expect(getVoiceSystemText('es-ES', 'no-input')).toContain('respuesta');
    expect(getVoiceSystemText('en-US', 'no-input')).toContain('did not receive');
  });

  it('renders prompt/retry templates for medication future in es-ES', () => {
    const bundle = getVoiceBundle('es-ES');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 30, 0, 0);
    const prompt = bundle.defaultPrompt({
      subjectAlias: 'Fernando',
      medicationName: 'Metformina 500mg',
      assistantName: 'Unid',
      taskType: 'medication',
      timingState: 'future',
      scheduledAtLabel: '09:30',
      scheduledAtIso: tomorrow.toISOString(),
    });

    expect(prompt).toContain('Metformina 500mg');
    expect(prompt).toContain('mañana a las 09:30');

    const retry2 = bundle.retryPrompt(2, {
      subjectAlias: 'Fernando',
      medicationName: 'Metformina 500mg',
      assistantName: 'Unid',
      taskType: 'medication',
      timingState: 'future',
      scheduledAtLabel: '09:30',
      scheduledAtIso: tomorrow.toISOString(),
    });
    expect(retry2).toContain('¿Está ahí?');
  });

  it('renders past/due medication prompt with explicit time in es-ES', () => {
    const bundle = getVoiceBundle('es-ES');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(9, 30, 0, 0);
    const prompt = bundle.defaultPrompt({
      subjectAlias: 'Fernando',
      medicationName: 'Paracetamol 500mg',
      assistantName: 'Unid',
      taskType: 'medication',
      timingState: 'due_or_past',
      scheduledAtLabel: '09:30',
      scheduledAtIso: yesterday.toISOString(),
    });

    expect(prompt).toContain('que fue ayer a las 09:30');
    expect(prompt).toContain('hace ');
  });

  it('renders past/due appointment prompt with explicit time in es-ES', () => {
    const bundle = getVoiceBundle('es-ES');
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    twoDaysAgo.setHours(18, 30, 0, 0);
    const prompt = bundle.defaultPrompt({
      subjectAlias: 'Fernando',
      medicationName: 'Cita cardiología',
      assistantName: 'Unid',
      taskType: 'appointment',
      timingState: 'due_or_past',
      scheduledAtLabel: '18:30',
      scheduledAtIso: twoDaysAgo.toISOString(),
    });

    expect(prompt).toContain('que fue el');
    expect(prompt).toContain('18:30');
    expect(prompt).toContain('hace ');
  });
});
