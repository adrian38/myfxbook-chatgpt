import type { MyfxbookAccount, MyfxbookHistoryItem } from './myfxbook';

export function buildUserPrompt(
  accounts: MyfxbookAccount[],
  histories: Record<number, MyfxbookHistoryItem[]>
): string {
  // Solo cuentas demo y resumen compacto
  const demo = accounts.filter(a => a.demo);
  const header = `Tengo ${demo.length} cuentas DEMO en Myfxbook. Resume rendimiento y riesgos, detecta patrones por símbolo y sugiere acciones de gestión.`;

  const lines: string[] = [header, '--- CUENTAS ---'];
  for (const a of demo) {
    lines.push(
      `• id=${a.id} | ${a.name} | broker=${a.server?.name ?? '-'} | bal=${a.balance ?? '-'} | profit=${a.profit ?? '-'} | dd=${a.drawdown ?? '-'} | ccy=${a.currency ?? '-'} | last=${a.lastUpdateDate ?? '-'}`
    );
  }

  lines.push('--- HISTÓRICO (máx 50 por cuenta) ---');
  for (const a of demo) {
    const h = histories[a.id] || [];
    const recent = h.slice(-50); // limita tamaño
    lines.push(`Cuenta ${a.id} (${a.name}) -> ${recent.length} trades`);
    for (const t of recent) {
      lines.push(
        `  - ${t.openTime}→${t.closeTime} | ${t.symbol} | ${t.action} | pips=${t.pips ?? '-'} | profit=${t.profit ?? '-'} | lots=${t.lots ?? '-'} | ${t.comment ?? ''}`
      );
    }
  }

  lines.push('--- SOLICITUD ---');
  lines.push(
    '1) Da un resumen ejecutivo claro. 2) Señala símbolos con resultados consistentes/irregulares. 3) Propón 3 acciones concretas para el próximo mes (gestión de riesgo, horarios, tamaño de posición, etc.).'
  );

  return lines.join('\n');
}
