import 'dotenv/config';
import axios, { AxiosInstance } from 'axios';
import { createObjectCsvWriter as createCsvWriter } from 'csv-writer';
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';

type AppConfig = {
  filters?: {
    demoOnly?: boolean;
    accountNameIncludes?: string[];
    accountIds?: number[];
    startDate?: string;
    endDate?: string;
    symbolsInclude?: string[];
    symbolsExclude?: string[];
    maxTradesPerAccount?: number;
  };
};

type Account = {
  id: number;
  name: string;
  demo: boolean;
  balance?: number;
  profit?: number;
  drawdown?: number;
  gain?: number;
  monthly?: string;
  lastUpdateDate?: string;
  currency?: string;
  server?: { name?: string } | any;
};

type HistoryItem = {
  openTime: string; closeTime: string; symbol: string; action: string;
  sizing?: { type?: string; value?: string };
  openPrice?: number; closePrice?: number; tp?: number; sl?: number;
  comment?: string; pips?: number; profit?: number; interest?: number; commission?: number; lots?: number;
};

function delay(ms: number){ return new Promise(r => setTimeout(r, ms)); }

function makeClient(baseURL: string): AxiosInstance {
  return axios.create({
    baseURL,
    headers: { 'User-Agent': 'myfxbook-export/1.1', 'Accept': 'application/json,text/xml,*/*' },
    validateStatus: function (s) { return s >= 200 && s < 400; }
  });
}

function readConfig(): AppConfig {
  const cfgPath = path.resolve('app.config.json');
  if (!fs.existsSync(cfgPath)) return {};
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    return JSON.parse(raw) as AppConfig;
  } catch {
    return {};
  }
}

async function login(http: AxiosInstance, email: string, password: string): Promise<string> {
  const resp = await http.get('/login.json', { params: { email: email.trim(), password: password.trim() } });
  const data = resp && resp.data ? resp.data : {};
  if (data.error) throw new Error('Login error: ' + (data.message || 'desconocido'));
  const session = String(data.session || '').trim();
  if (!session) throw new Error('No se recibió "session" en el login');
  return session;
}

async function getAccountsRobusto(session: string): Promise<Account[]> {
  let http = makeClient('https://www.myfxbook.com/api');
  try {
    const r = await http.get('/get-my-accounts.json', { params: { session: session } });
    const d = r && r.data ? r.data : {};
    if (!d.error && Array.isArray(d.accounts)) return d.accounts;
  } catch {}
  try {
    const url = '/get-my-accounts.json?session=' + session;
    const r = await http.get(url, { headers: { Cookie: 'PHPSESSID=' + session } });
    const d = r && r.data ? r.data : {};
    if (!d.error && Array.isArray(d.accounts)) return d.accounts;
  } catch {}
  http = makeClient('https://myfxbook.com/api');
  try {
    const r = await http.get('/get-my-accounts.json', { params: { session: session } });
    const d = r && r.data ? r.data : {};
    if (!d.error && Array.isArray(d.accounts)) return d.accounts;
  } catch {}
  try {
    const r = await axios.get('https://www.myfxbook.com/api/get-my-accounts.xml?session=' + encodeURIComponent(session), {
      headers: { 'User-Agent': 'myfxbook-export/1.1', 'Accept': 'text/xml' },
      validateStatus: function (s) { return s >= 200 && s < 400; }
    });
    const parser = new XMLParser({ ignoreAttributes: false });
    const xml = parser.parse(r.data);
    const resp = xml && xml.response ? xml.response : {};
    if (String(resp.error) === 'false' && resp.accounts) {
      const arr = Array.isArray(resp.accounts.account) ? resp.accounts.account : [resp.accounts.account];
      return arr.map(function(a: any){
        return {
          id: Number(a.id),
          name: a.name,
          demo: String(a.demo) === 'true' || a.demo === true || a.demo === 1,
          balance: a.balance ? Number(a.balance) : undefined,
          profit: a.profit ? Number(a.profit) : undefined,
          drawdown: a.drawdown ? Number(a.drawdown) : undefined,
          gain: a.gain ? Number(a.gain) : undefined,
          monthly: a.monthly,
          currency: a.currency,
          server: a.server,
          lastUpdateDate: a.lastUpdateDate
        } as Account;
      });
    }
  } catch {}
  throw new Error('Accounts error: Invalid session (tras múltiples intentos)');
}

async function getHistoryRobusto(session: string, accountId: number): Promise<HistoryItem[]> {
  let http = makeClient('https://www.myfxbook.com/api');
  try {
    const r = await http.get('/get-history.json', { params: { session: session, id: accountId } });
    const d = r && r.data ? r.data : {};
    if (!d.error && Array.isArray(d.history)) return d.history;
  } catch {}
  try {
    const url = '/get-history.json?session=' + session + '&id=' + accountId;
    const r = await http.get(url, { headers: { Cookie: 'PHPSESSID=' + session } });
    const d = r && r.data ? r.data : {};
    if (!d.error && Array.isArray(d.history)) return d.history;
  } catch {}
  http = makeClient('https://myfxbook.com/api');
  try {
    const r = await http.get('/get-history.json', { params: { session: session, id: accountId } });
    const d = r && r.data ? r.data : {};
    if (!d.error && Array.isArray(d.history)) return d.history;
  } catch {}
  return [];
}

function normalize(s: string): string {
  return (s || '').toLowerCase();
}

function tradeDateKey(h: HistoryItem): string {
  const s = (h.closeTime || h.openTime || '').split(' ')[0]; // MM/DD/YYYY
  if (!s) return '';
  const p = s.split('/');
  if (p.length !== 3) return '';
  const mm = p[0].padStart(2, '0');
  const dd = p[1].padStart(2, '0');
  const yyyy = p[2];
  return yyyy + '-' + mm + '-' + dd; // yyyy-mm-dd
}

async function main() {
  const cfg = readConfig();
  const filters = (cfg && cfg.filters) ? cfg.filters : {};
  const demoOnly = !!filters.demoOnly;
  const nameIncludes = Array.isArray(filters.accountNameIncludes) ? filters.accountNameIncludes.map(normalize) : [];
  const idList = Array.isArray(filters.accountIds) ? filters.accountIds : [];
  const startDate = (filters.startDate || '').trim();
  const endDate = (filters.endDate || '').trim();
  const symInc = Array.isArray(filters.symbolsInclude) ? filters.symbolsInclude.map(normalize) : [];
  const symExc = Array.isArray(filters.symbolsExclude) ? filters.symbolsExclude.map(normalize) : [];
  const maxTrades = typeof filters.maxTradesPerAccount === 'number' ? filters.maxTradesPerAccount : 0;

  const email = (process.env.MYFXBOOK_EMAIL || '').trim();
  const password = (process.env.MYFXBOOK_PASSWORD || '').trim();
  if (!email || !password) throw new Error('Faltan MYFXBOOK_EMAIL o MYFXBOOK_PASSWORD en .env');

  const outDir = path.resolve('out');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const http = makeClient('https://www.myfxbook.com/api');

  const session = await login(http, email, password);
  console.log('Login OK. Session:', session.slice(0, 6) + '...');

  try {
    await delay(500);
    const accounts = await getAccountsRobusto(session);

    // === FILTROS DE CUENTAS ===
    let selected = accounts.slice();

    if (demoOnly) {
      selected = selected.filter(function(a){ return a.demo === true; });
    }
    if (idList.length > 0) {
      const set = new Set(idList);
      selected = selected.filter(function(a){ return set.has(a.id); });
    } else if (nameIncludes.length > 0) {
      selected = selected.filter(function(a){
        const nm = normalize(a.name || '');
        for (const kw of nameIncludes) {
          if (kw && nm.indexOf(kw) !== -1) return true;
        }
        return false;
      });
    }

    // CSV de cuentas filtradas
    const accountsCsv = createCsvWriter({
      path: path.join(outDir, 'accounts.csv'),
      header: [
        { id: 'id', title: 'id' },
        { id: 'name', title: 'name' },
        { id: 'demo', title: 'demo' },
        { id: 'server', title: 'server' },
        { id: 'currency', title: 'currency' },
        { id: 'balance', title: 'balance' },
        { id: 'profit', title: 'profit' },
        { id: 'drawdown', title: 'drawdown' },
        { id: 'gain', title: 'gain' },
        { id: 'monthly', title: 'monthly' },
        { id: 'lastUpdateDate', title: 'lastUpdateDate' }
      ]
    });

    await accountsCsv.writeRecords(selected.map(function(a){
      return {
        id: a.id,
        name: a.name,
        demo: a.demo,
        server: a.server && a.server.name ? a.server.name : (typeof a.server === 'string' ? a.server : ''),
        currency: a.currency || '',
        balance: a.balance || '',
        profit: a.profit || '',
        drawdown: a.drawdown || '',
        gain: a.gain || '',
        monthly: a.monthly || '',
        lastUpdateDate: a.lastUpdateDate || ''
      };
    }));
    console.log('accounts.csv (filtrado) generado en /out');

    // HISTÓRICO por cuenta seleccionada
    for (const acc of selected) {
      const raw = await getHistoryRobusto(session, acc.id);

      // filtros sobre trades
      let trades = raw.slice();

      if (startDate || endDate) {
        trades = trades.filter(function(t){
          const key = tradeDateKey(t);
          if (!key) return true;
          if (startDate && key < startDate) return false;
          if (endDate && key > endDate) return false;
          return true;
        });
      }

      if (symInc.length > 0 || symExc.length > 0) {
        trades = trades.filter(function(t){
          const s = normalize(t.symbol || '');
          if (symInc.length > 0) {
            let ok = false;
            for (const inc of symInc) {
              if (inc && s.indexOf(inc) !== -1) { ok = true; break; }
            }
            if (!ok) return false;
          }
          if (symExc.length > 0) {
            for (const exc of symExc) {
              if (exc && s.indexOf(exc) !== -1) return false;
            }
          }
          return true;
        });
      }

      if (maxTrades > 0 && trades.length > maxTrades) {
        trades = trades.slice(-maxTrades); // últimos N
      }

      const csv = createCsvWriter({
        path: path.join(outDir, `history_${acc.id}.csv`),
        header: [
          { id: 'openTime', title: 'openTime' },
          { id: 'closeTime', title: 'closeTime' },
          { id: 'symbol', title: 'symbol' },
          { id: 'action', title: 'action' },
          { id: 'lots', title: 'lots' },
          { id: 'openPrice', title: 'openPrice' },
          { id: 'closePrice', title: 'closePrice' },
          { id: 'tp', title: 'tp' },
          { id: 'sl', title: 'sl' },
          { id: 'pips', title: 'pips' },
          { id: 'profit', title: 'profit' },
          { id: 'interest', title: 'interest' },
          { id: 'commission', title: 'commission' },
          { id: 'comment', title: 'comment' }
        ]
      });

      await csv.writeRecords(trades.map(function(t: any){
        const lots = typeof t.lots !== 'undefined' ? t.lots : (t.sizing && t.sizing.value ? t.sizing.value : '');
        return {
          openTime: t.openTime || '',
          closeTime: t.closeTime || '',
          symbol: t.symbol || '',
          action: t.action || '',
          lots: lots,
          openPrice: typeof t.openPrice === 'number' ? t.openPrice : '',
          closePrice: typeof t.closePrice === 'number' ? t.closePrice : '',
          tp: typeof t.tp === 'number' ? t.tp : '',
          sl: typeof t.sl === 'number' ? t.sl : '',
          pips: typeof t.pips === 'number' ? t.pips : '',
          profit: typeof t.profit === 'number' ? t.profit : '',
          interest: typeof t.interest === 'number' ? t.interest : '',
          commission: typeof t.commission === 'number' ? t.commission : '',
          comment: t.comment || ''
        };
      }));

      console.log(`history_${acc.id}.csv generado (${trades.length} filas)`);
    }
  } finally {
    try {
      await http.get('/logout.json', { params: { session: session } });
      console.log('Logout OK');
    } catch {}
  }
}

main().catch(function (e) {
  console.error('Error:', e.message);
  process.exit(1);
});
