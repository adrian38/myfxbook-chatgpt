import 'dotenv/config';
import OpenAI from 'openai';
import { MyfxbookClient } from './myfxbook';
import { buildUserPrompt } from './prompt';

async function main() {
  const email = process.env.MYFXBOOK_EMAIL || '';
  const password = process.env.MYFXBOOK_PASSWORD || '';
  const openaiKey = process.env.OPENAI_API_KEY || '';
  if (!email || !password) throw new Error('Faltan MYFXBOOK_EMAIL/MYFXBOOK_PASSWORD');
  if (!openaiKey) throw new Error('Falta OPENAI_API_KEY');

  // 1) Myfxbook
  const myfx = new MyfxbookClient(email, password);
  const session = await myfx.login();
  const accounts = await myfx.getAccounts(session);
  const demo = accounts.filter(a => a.demo);
  if (demo.length === 0) {
    console.log('No hay cuentas DEMO en Myfxbook.');
    await myfx.logout(session);
    return;
  }

  const histories: Record<number, any[]> = {};
  for (const a of demo) {
    histories[a.id] = await myfx.getHistory(session, a.id);
  }
  await myfx.logout(session);

  // 2) Construir prompt
  const userPrompt = buildUserPrompt(accounts, histories);

  // 3) ChatGPT (OpenAI Responses API con el SDK oficial)
  const openai = new OpenAI({ apiKey: openaiKey });

  // Si prefieres chat estilo mensajes, también sirve; aquí uso Responses (docs Quickstart/Guides).
  const response = await openai.responses.create({
    model: "gpt-4.1-mini", // elige el modelo disponible en tu cuenta
    input: [
      {
        role: "system",
        content:
          "Eres un analista cuantitativo. Ofrece análisis claro, cuantitativo y accionable. Resalta supuestos y limita sesgos."
      },
      {
        role: "user",
        content: userPrompt
      }
    ]
  });

  // Extraer texto
  const out = response.output?.[0]?.content?.[0]?.text ?? JSON.stringify(response, null, 2);
  console.log('\n=== RESPUESTA DEL MODELO ===\n');
  console.log(out);
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
