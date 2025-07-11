import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

// Pour __dirname équivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5004;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Connexion PostgreSQL
const pool = new Pool({
  user: 'ue4cqkav5o8jfl',
  host: 'postgres-prod.wartnerpro.io',
  database: 'd66k62itvf3kmq',
  password: 'p9dda30e2c723dd7e46e474c00a4b57fb1fb991ebbab59cceb39fb1bbb2e9d47f',
  port: 5432,
});

// (le reste du code backend reste inchangé)

app.get('/api2/livraison', async (req, res) => {
  try {
    const { date, commande } = req.query;
    let condition = [];
    let params = [];

    if (commande) {
      condition.push(`commande__c.name ILIKE $1`);
      params.push(`%${commande}%`);
    } else if (date) {
      condition.push(`DATE(commande__c.datelivraison__c) = DATE($1)`);
      params.push(date);
    } else {
      condition.push(`DATE(commande__c.datelivraison__c) = CURRENT_DATE - INTERVAL '1 day'`);
    }

    const whereClause = condition.length ? `WHERE ${condition.join(' AND ')}` : '';

    const query = `
      SELECT 
        lignecommande__c.sfid AS id,
        account.name AS compte,
        commande__c.name AS commande,
        lignecommande__c.produit__c AS produit,
        lignecommande__c.nombrecommande__c AS nombre_commande,
        lignecommande__c.nombreexpediee__c AS nombre_expedie,
        lignecommande__c.qt_theorique__c AS qt_theorique,
        lignecommande__c.commentaire__c AS commentaire,
        lignecommande__c.statut__c AS statut,
        lignecommande__c.typededevis__c AS typededevis__c
      FROM salesforce.lignecommande__c
      INNER JOIN salesforce.commande__c 
        ON lignecommande__c.commande__c = commande__c.sfid
      INNER JOIN salesforce.account 
        ON commande__c.compte__c = account.sfid
      ${whereClause}
      ORDER BY lignecommande__c.createddate DESC, produit__c
    `;

    const result = await pool.query(query, params);
    const data = result.rows;

    const comptes = [...new Set(data.map(r => r.compte).filter(Boolean))].sort();
    const statuts = [...new Set(data.map(r => r.statut).filter(Boolean))].sort();
    const types = [...new Set(data.map(r => r.typededevis__c).filter(Boolean))].sort();
    const commandes = [...new Set(data.map(r => r.commande).filter(Boolean))].sort();

    if (!statuts.includes("préparé")) statuts.push("préparé");

    res.json({
      lignes: data,
      comptes,
      statuts,
      types,
      commandes,
    });
  } catch (err) {
    console.error("❌ Erreur API /api2/livraison :", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api2/save', async (req, res) => {
  const modifs = req.body;
  try {
    const client = await pool.connect();
    try {
      for (const mod of modifs) {
        await client.query(
          `UPDATE salesforce.lignecommande__c
           SET commentaire__c = $1, statut__c = $2
           WHERE sfid = $3`,
          [mod.commentaire || '', mod.statut || '', mod.id]
        );
      }
      res.sendStatus(204);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("❌ Erreur API /api2/save :", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Backend démarré sur http://localhost:${PORT}`);
});
