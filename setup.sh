#!/bin/bash

echo "🚀 A iniciar a criação do projeto ENDA Market..."

# Criar pasta principal
mkdir -p enda-market
cd enda-market

# ---------------------------------------------------------
# 1. DOCKER COMPOSE
# ---------------------------------------------------------
echo "🐳 A criar docker-compose.yml..."
cat << 'EOF' > docker-compose.yml
version: '3.8'
services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: enda_user
      POSTGRES_PASSWORD: enda_password
      POSTGRES_DB: endapredicts
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  backend:
    build: ./backend
    ports:
      - "5000:5000"
    environment:
      DATABASE_URL: postgres://enda_user:enda_password@db:5432/endapredicts
      PORT: 5000
    depends_on:
      - db

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - CHOKIDAR_USEPOLLING=true
    depends_on:
      - backend

volumes:
  pgdata:
EOF

# ---------------------------------------------------------
# 2. BACKEND
# ---------------------------------------------------------
echo "⚙️ A criar ficheiros do Backend..."
mkdir -p backend
cd backend

cat << 'EOF' > Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5000
CMD ["npm", "start"]
EOF

cat << 'EOF' > package.json
{
  "name": "enda-backend",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "pg": "^8.11.3"
  }
}
EOF

cat << 'EOF' > server.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      balance INTEGER DEFAULT 1000
    );
    CREATE TABLE IF NOT EXISTS markets (
      id SERIAL PRIMARY KEY,
      question TEXT NOT NULL,
      category VARCHAR(50),
      yes_pool INTEGER DEFAULT 100,
      no_pool INTEGER DEFAULT 100
    );
    CREATE TABLE IF NOT EXISTS bets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      market_id INTEGER REFERENCES markets(id),
      outcome VARCHAR(3) CHECK (outcome IN ('YES', 'NO')),
      amount INTEGER NOT NULL
    );
  `);

  const { rowCount } = await pool.query('SELECT * FROM markets');
  if (rowCount === 0) {
    await pool.query(`INSERT INTO users (username) VALUES ('delegado_teste') ON CONFLICT DO NOTHING`);
    await pool.query(`
      INSERT INTO markets (question, category, yes_pool, no_pool) VALUES 
      ('A Moção de Estratégia Global será aprovada por unanimidade?', 'Político', 650, 350),
      ('O próximo ENDA será em Coimbra?', 'Logística', 400, 600)
    `);
  }
}

initDB().catch(console.error);

app.get('/api/markets', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM markets ORDER BY id ASC');
    const markets = result.rows.map(m => {
      const total = m.yes_pool + m.no_pool;
      return {
        ...m,
        yesPrice: (m.yes_pool / total).toFixed(2),
        noPrice: (m.no_pool / total).toFixed(2)
      };
    });
    res.json(markets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bet', async (req, res) => {
  const { userId, marketId, outcome, amount } = req.body;
  try {
    await pool.query('BEGIN');
    await pool.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amount, userId]);
    await pool.query('INSERT INTO bets (user_id, market_id, outcome, amount) VALUES ($1, $2, $3, $4)', [userId, marketId, outcome, amount]);
    const poolColumn = outcome === 'YES' ? 'yes_pool' : 'no_pool';
    await pool.query(`UPDATE markets SET ${poolColumn} = ${poolColumn} + $1 WHERE id = $2`, [amount, marketId]);
    await pool.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Servidor a correr na porta ${PORT}`));
EOF

cd ..

# ---------------------------------------------------------
# 3. FRONTEND
# ---------------------------------------------------------
echo "🎨 A criar ficheiros do Frontend..."
mkdir -p frontend/src frontend/public
cd frontend

cat << 'EOF' > Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
EOF

cat << 'EOF' > package.json
{
  "name": "enda-frontend",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-scripts": "5.0.1"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build"
  },
  "browserslist": {
    "production": [">0.2%", "not dead", "not op_mini all"],
    "development": ["last 1 chrome version", "last 1 firefox version", "last 1 safari version"]
  }
}
EOF

cat << 'EOF' > public/index.html
<!DOCTYPE html>
<html lang="pt">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ENDA Market</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body>
    <noscript>Precisas de ativar o JavaScript para correr esta app.</noscript>
    <div id="root"></div>
  </body>
</html>
EOF

cat << 'EOF' > src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
EOF

cat << 'EOF' > src/App.js
import React, { useState, useEffect } from 'react';

export default function ENDAMarket() {
  const [balance, setBalance] = useState(1000);
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('http://localhost:5000/api/markets')
      .then(res => res.json())
      .then(data => {
        setMarkets(data);
        setLoading(false);
      })
      .catch(err => console.error("Erro a carregar mercados:", err));
  }, []);

  const handleBet = async (marketId, outcome) => {
    const betAmount = 10;
    if (balance < betAmount) {
      alert("Tokens insuficientes!");
      return;
    }
    try {
      setBalance(prev => prev - betAmount);
      const response = await fetch('http://localhost:5000/api/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 1, marketId: marketId, outcome: outcome, amount: betAmount })
      });
      if (response.ok) {
        const updatedMarkets = await fetch('http://localhost:5000/api/markets').then(res => res.json());
        setMarkets(updatedMarkets);
      }
    } catch (err) {
      console.error("Erro ao fazer a aposta:", err);
      setBalance(prev => prev + betAmount);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6 font-sans">
      <header className="flex justify-between items-center mb-10 border-b border-gray-700 pb-4">
        <h1 className="text-2xl font-bold tracking-tighter">ENDA <span className="text-blue-500">MARKET</span></h1>
        <div className="bg-gray-800 px-4 py-2 rounded-full border border-blue-500">
          💰 {balance} <span className="text-xs text-gray-400">Tokens ENDA</span>
        </div>
      </header>

      {loading ? (
        <div className="text-center text-gray-400 mt-20 animate-pulse">A carregar a ordem de trabalhos do ENDA...</div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {markets.map((market) => (
            <div key={market.id} className="bg-gray-800 p-6 rounded-xl border border-gray-700 hover:border-blue-400 transition shadow-lg">
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-400">{market.category}</span>
              <h2 className="text-lg font-medium mt-2 mb-6 h-14">{market.question}</h2>
              
              <div className="flex gap-3">
                <button onClick={() => handleBet(market.id, 'YES')} className="flex-1 bg-green-600 hover:bg-green-500 py-3 rounded-lg font-bold transition flex flex-col items-center">
                  SIM <span className="text-xs font-normal opacity-80 text-green-100 mt-1">{Math.round(market.yesPrice * 100)}%</span>
                </button>
                <button onClick={() => handleBet(market.id, 'NO')} className="flex-1 bg-red-600 hover:bg-red-500 py-3 rounded-lg font-bold transition flex flex-col items-center">
                  NÃO <span className="text-xs font-normal opacity-80 text-red-100 mt-1">{Math.round(market.noPrice * 100)}%</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
EOF

cd ..

echo "✅ Tudo pronto! Para arrancar, corre:"
echo "cd enda-market && docker-compose up --build"
