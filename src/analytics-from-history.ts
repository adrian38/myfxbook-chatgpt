// scripts/analytics-from-history.ts
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import dayjs from 'dayjs';

type Trade = {
    openTime: string;
    closeTime: string;
    symbol: string;
    action?: string;
    openPrice?: number;
    closePrice?: number;
    pips?: number;
    profit?: number;
    lots?: number;
};

function safeNum(v: any) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function readCsv(file: string): Trade[] {
    const raw = fs.readFileSync(file, 'utf8');
    const rows = parse(raw, { columns: true, skip_empty_lines: true });
    return rows.map((r: any) => ({
        openTime: r.openTime || r.open_time || r['Open Time'] || r['open_time'] || '',
        closeTime: r.closeTime || r.close_time || r['Close Time'] || r['close_time'] || '',
        symbol: r.symbol || r.Symbol || '',
        action: r.action || r.Action || '',
        openPrice: safeNum(r.openPrice || r.open_price || r['Open Price']),
        closePrice: safeNum(r.closePrice || r.close_price || r['Close Price']),
        pips: safeNum(r.pips || r.Pips),
        profit: safeNum(r.profit || r.Profit),
        lots: safeNum(r.lots || r.Lots),
    }));
}

function summariseTrades(trades: Trade[]) {
    const total = trades.length;
    const wins = trades.filter((t) => (t.profit ?? 0) > 0);
    const losses = trades.filter((t) => (t.profit ?? 0) < 0);
    const sumProfit = trades.reduce((s, t) => s + (t.profit ?? 0), 0);
    const sumWins = wins.reduce((s, t) => s + (t.profit ?? 0), 0);
    const sumLosses = losses.reduce((s, t) => s + (t.profit ?? 0), 0);
    const avgWin = wins.length ? sumWins / wins.length : 0;
    const avgLoss = losses.length ? sumLosses / losses.length : 0;
    const winRate = total ? wins.length / total : 0;
    const profitFactor = Math.abs(sumLosses) > 1e-9 ? sumWins / Math.abs(sumLosses) : Infinity;
    const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;
    const pipsTotal = trades.reduce((s, t) => s + (t.pips ?? 0), 0);

    return { total, wins: wins.length, losses: losses.length, winRate, sumProfit, sumWins, sumLosses, avgWin, avgLoss, profitFactor, expectancy, pipsTotal };
}

function groupBy<T, K extends string | number>(arr: T[], keyFn: (x: T) => K) {
    const map = new Map<K, T[]>();
    for (const it of arr) {
        const k = keyFn(it);
        const a = map.get(k) ?? [];
        a.push(it);
        map.set(k, a);
    }
    return map;
}

function hourlyAnalytics(trades: Trade[]) {
    const map = new Map<string, Trade[]>();
    for (const t of trades) {
        const time = t.closeTime || t.openTime;
        const h = time ? dayjs(time).format('HH') : 'xx';
        const arr = map.get(h) ?? [];
        arr.push(t);
        map.set(h, arr);
    }
    const out: Record<string, any> = {};
    for (const [h, arr] of map.entries()) out[h] = summariseTrades(arr);
    return out;
}

function monthlyAnalytics(trades: Trade[]) {
    const map = groupBy(trades, (t) => {
        const time = t.closeTime || t.openTime;
        return time ? dayjs(time).format('YYYY-MM') : 'unknown';
    });
    const out: Record<string, any> = {};
    for (const [m, arr] of map.entries()) out[String(m)] = summariseTrades(arr);
    return out;
}

function durationStats(trades: Trade[]) {
    const durations = trades
        .map((t) => {
            try {
                const s = dayjs(t.openTime);
                const e = dayjs(t.closeTime);
                return e.isValid() && s.isValid() ? e.diff(s, 'seconds') : null;
            } catch {
                return null;
            }
        })
        .filter((v) => v !== null) as number[];
    if (!durations.length) return { count: 0 };
    durations.sort((a, b) => a - b);
    const sum = durations.reduce((s, x) => s + x, 0);
    const mean = sum / durations.length;
    const median = durations[Math.floor(durations.length / 2)];
    return { count: durations.length, meanSeconds: mean, medianSeconds: median, min: durations[0], max: durations[durations.length - 1] };
}

// CLI
if (require.main === module) {
    const f = process.argv[2];
    if (!f) {
        console.error('node analytics-from-history.js <history.csv>');
        process.exit(1);
    }
    const trades = readCsv(f);
    console.log('Total trades read:', trades.length);

    const globalSummary = summariseTrades(trades);
    console.log('Global summary:', globalSummary);

    // by symbol
    const bySymbol = Object.fromEntries(Array.from(groupBy(trades, (t) => t.symbol).entries()).map(([k, v]) => [k, summariseTrades(v)]));
    fs.writeFileSync('out_summary_by_symbol.json', JSON.stringify(bySymbol, null, 2));

    // hourly
    const hourly = hourlyAnalytics(trades);
    fs.writeFileSync('out_hourly.json', JSON.stringify(hourly, null, 2));

    // monthly
    const monthly = monthlyAnalytics(trades);
    fs.writeFileSync('out_monthly.json', JSON.stringify(monthly, null, 2));

    // duration
    const duration = durationStats(trades);
    fs.writeFileSync('out_duration.json', JSON.stringify(duration, null, 2));

    console.log('Archivos generados: out_summary_by_symbol.json, out_hourly.json, out_monthly.json, out_duration.json');
}
