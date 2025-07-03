from flask import Flask, jsonify, request, send_from_directory
from sqlalchemy import create_engine, text
from flask_cors import CORS
import datetime
import os

app = Flask(__name__)
CORS(app)  # Pour autoriser l'accès depuis le HTML local ou mobile

# Connexion PostgreSQL
engine = create_engine(
    'postgresql+psycopg2://ue4cqkav5o8jfl:p9dda30e2c723dd7e46e474c00a4b57fb1fb991ebbab59cceb39fb1bbb2e9d47f@postgres-prod.wartnerpro.io:5432/d66k62itvf3kmq'
)

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/api/livraison')
def get_livraison():
    today = datetime.date.today()
    query = text("""
        SELECT 
            lignecommande__c.sfid AS id,
            account.name AS compte,
            lignecommande__c.produit__c AS produit,
            lignecommande__c.nombrecommande__c AS nombre_commande,
            lignecommande__c.nombreexpediee__c AS nombre_expedie,
            lignecommande__c.commentaire__c AS commentaire,
            lignecommande__c.createddate,
            commande__c.statut__c AS statut
        FROM salesforce.lignecommande__c
        INNER JOIN salesforce.commande__c 
            ON lignecommande__c.commande__c = commande__c.sfid
        INNER JOIN salesforce.account 
            ON commande__c.compte__c = account.sfid
        WHERE DATE(lignecommande__c.createddate) = :today
        ORDER BY account.name, lignecommande__c.createddate DESC, lignecommande__c.produit__c
    """)
    with engine.connect() as conn:
        rows = conn.execute(query, {"today": today}).mappings().all()
    return jsonify([dict(r) for r in rows])

@app.route('/api/save', methods=['POST'])
def save_modifications():
    modifs = request.json  # [{ id, exp, commentaire }, ...]
    with engine.begin() as conn:
        for mod in modifs:
            update = text("""
                UPDATE salesforce.lignecommande__c
                SET 
                    nombreexpediee__c = :exp,
                    commentaire__c = :commentaire
                WHERE sfid = :id
            """)
            conn.execute(update, {
                "exp": mod['exp'],
                "commentaire": mod.get('commentaire', ''),
                "id": mod['id']
            })
    return '', 204

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host='0.0.0.0', port=port)
