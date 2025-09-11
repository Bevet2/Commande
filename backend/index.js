// index.js (backend)

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

// --- __dirname équivalent pour ES modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- App / Port ---
const app = express();
const PORT = process.env.PORT || 5004;

// --- Middlewares ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// --- PostgreSQL ---
const pool = new Pool({
  user: 'ue4cqkav5o8jfl',
  host: 'postgres-prod.wartnerpro.io',
  database: 'd66k62itvf3kmq',
  password: 'p9dda30e2c723dd7e46e474c00a4b57fb1fb991ebbab59cceb39fb1bbb2e9d47f',
  port: 5432,
  // ssl: { rejectUnauthorized: false }, // si besoin
});

// ---------------------------------------------------------
//            SSE : diffusion des mises à jour
// ---------------------------------------------------------
const sseClients = new Set();

/** Diffuse un message JSON à tous les clients SSE */
function sseBroadcast(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(msg);
    } catch {
      // client mort : il sera supprimé à la prochaine fermeture
    }
  }
}

/** Endpoint SSE */
app.get('/api2/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
  });
  // envoie immédiat d’un hello (utile pour ouvrir le flux côté client)
  res.write(`data: ${JSON.stringify({ type: 'hello', at: Date.now() })}\n\n`);

  sseClients.add(res);

  // heartbeat pour éviter la coupure par certains proxies (30s)
  const keepAlive = setInterval(() => {
    res.write(': ping\n\n'); // commentaire SSE (ne déclenche pas onmessage)
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

// ---------------------------------------------------------
//                 API: GET /api2/livraison
// ---------------------------------------------------------
app.get('/api2/livraison', async (req, res) => {
  try {
    const { date, commande } = req.query;
    const clauses = [];
    const params = [];

    // Filtre commande (optionnel)
    if (commande) {
      clauses.push(`c.name ILIKE $${params.length + 1}`);
      params.push(`%${commande}%`);
    }

    // Filtre date de livraison (optionnel)
    if (date) {
      // si c.datelivraison__c est DATE ou TIMESTAMP, ceci marche dans les deux cas
      clauses.push(`DATE(c.datelivraison__c) = $${params.length + 1}::date`);
      params.push(date);
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const query = `
      SELECT 
        lc.sfid                AS id,
        a.name                 AS compte,
        c.name                 AS commande,
        lc.produit__c          AS produit,
        lc.nombrecommande__c   AS nombre_commande,
        lc.nombreexpediee__c   AS nombre_expedie,
        lc.qt_theorique__c     AS qt_theorique,
        (COALESCE(lc.statut__c,'') ILIKE 'préparé') AS prepared,
        lc.typededevis__c      AS typededevis__c
      FROM salesforce.lignecommande__c lc
      JOIN salesforce.commande__c c ON lc.commande__c = c.sfid
      JOIN salesforce.account     a ON c.compte__c    = a.sfid
      ${whereClause}
      ORDER BY lc.createddate DESC, lc.produit__c
    `;

    const result = await pool.query(query, params);
    const data = result.rows;

    const comptes   = [...new Set(data.map(r => r.compte).filter(Boolean))].sort();
    const types     = [...new Set(data.map(r => r.typededevis__c).filter(Boolean))].sort();
    const commandes = [...new Set(data.map(r => r.commande).filter(Boolean))].sort();

    res.json({ lignes: data, comptes, types, commandes });
  } catch (err) {
    console.error('❌ Erreur API /api2/livraison :', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
//                 API: POST /api2/save
//  - accepte un objet ou un tableau d’objets { id, prepared }
//  - transaction
//  - broadcast SSE après COMMIT
// ---------------------------------------------------------
app.post('/api2/save', async (req, res) => {
  const modifs = Array.isArray(req.body) ? req.body : [req.body];

  if (!modifs.length) return res.sendStatus(204);

  let client;
  const changedIds = [];

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    for (const mod of modifs) {
      if (!mod || !mod.id) continue;
      const prepared = !!mod.prepared;

      await client.query(
        `UPDATE salesforce.lignecommande__c
         SET statut__c = CASE WHEN $1::boolean THEN 'préparé' ELSE NULL END
         WHERE sfid = $2`,
        [prepared, mod.id]
      );

      changedIds.push(mod.id);
    }

    await client.query('COMMIT');
    // Diffusion d’un événement pour rafraîchir les autres clients
    sseBroadcast({ type: 'prepared_update', ids: changedIds, at: Date.now() });

    return res.sendStatus(204);
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    console.error('❌ Erreur API /api2/save :', err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
});

// ---------------------------------------------------------
//                      Divers
// ---------------------------------------------------------
app.get('/health', (_req, res) => res.json({ ok: true, at: Date.now() }));

// Fallback SPA (si vous avez un front mono-page dans ../frontend/index.html)
app.get('*', (req, res, next) => {
  // ne pas écraser les routes API
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ---------------------------------------------------------
//                    Lancement serveur
// ---------------------------------------------------------
app.listen(PORT, () => {
  console.log(`✅ Backend démarré sur http://localhost:${PORT}`);
});
