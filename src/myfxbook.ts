import axios from 'axios';

export type MyfxbookAccount = {
  id: number;
  name: string;
  demo: boolean;
  balance?: number;
  profit?: number;
  drawdown?: number;
  server?: { name?: string };
  currency?: string;
  lastUpdateDate?: string;
};

export type MyfxbookHistoryItem = {
  openTime: string;
  closeTime: string;
  symbol: string;
  action: string;
  pips?: number;
  profit?: number;
  lots?: number;
  comment?: string;
};

export class MyfxbookClient {
  private http = axios.create({
    baseURL: 'https://www.myfxbook.com/api',
    headers: { 'User-Agent': 'myfxbook-client/1.0' },
    validateStatus: (s) => s >= 200 && s < 400
  });

  constructor(private email: string, private password: string) {}

  async login(): Promise<string> {
    const { data } = await this.http.get('/login.json', {
      params: { email: this.email.trim(), password: this.password.trim() }
    });
    if (data?.error) throw new Error(`Login error: ${data.message || 'desconocido'}`);
    const session = String(data?.session || '').trim();
    if (!session) throw new Error('No se recibió "session" en el login');
    return session;
  }

  async getAccounts(session: string): Promise<MyfxbookAccount[]> {
    const { data } = await this.http.get('/get-my-accounts.json', { params: { session } });
    if (data?.error) throw new Error(`Accounts error: ${data.message || 'desconocido'}`);
    return Array.isArray(data?.accounts) ? data.accounts : [];
  }

  async getHistory(session: string, id: number): Promise<MyfxbookHistoryItem[]> {
    const { data } = await this.http.get('/get-history.json', { params: { session, id } });
    if (data?.error) throw new Error(`History error: ${data.message || 'desconocido'}`);
    return Array.isArray(data?.history) ? data.history : [];
  }

  async logout(session: string): Promise<void> {
    await this.http.get('/logout.json', { params: { session } }).catch(() => {});
  }
}
