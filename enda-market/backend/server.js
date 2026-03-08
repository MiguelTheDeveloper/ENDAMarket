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
  let retries = 5;
  while (retries) {
    try {
      await pool.query('SELECT NOW()');
      break; 
    } catch (err) {
      retries -= 1;
      await new Promise(res => setTimeout(res, 3000));
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      balance INTEGER DEFAULT 1000,
      is_admin BOOLEAN DEFAULT FALSE
    );
    
    CREATE TABLE IF NOT EXISTS markets (
      id SERIAL PRIMARY KEY,
      question TEXT NOT NULL,
      type VARCHAR(20) DEFAULT 'SIM_NAO',
      pool_a INTEGER DEFAULT 100,
      pool_b INTEGER DEFAULT 100,
      status VARCHAR(20) DEFAULT 'OPEN', -- 'OPEN' ou 'RESOLVED'
      winning_outcome VARCHAR(1) -- 'A' ou 'B' (nulo se aberto)
    );

    CREATE TABLE IF NOT EXISTS bets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      market_id INTEGER REFERENCES markets(id),
      outcome VARCHAR(1),
      amount INTEGER NOT NULL,
      payout INTEGER DEFAULT 0, -- O que o utilizador ganhou (0 se perdeu ou pendente)
      UNIQUE(user_id, market_id)
    );
  `);

  const adminCheck = await pool.query("SELECT * FROM users WHERE username = 'admin'");
  if (adminCheck.rowCount === 0) {
    await pool.query("INSERT INTO users (username, password, is_admin) VALUES ('admin', 'admin123', TRUE)");
  }
}

initDB().catch(console.error);

// --- ROTAS ---

app.post('/api/auth', async (req, res) => {
  const { username, password } = req.body;
  try {
    let user = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (user.rowCount === 0) {
      user = await pool.query('INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username, balance, is_admin', [username, password]);
      return res.json(user.rows[0]);
    }
    if (user.rows[0].password !== password) return res.status(401).json({ error: 'Password incorreta' });
    const { id, balance, is_admin } = user.rows[0];
    res.json({ id, username, balance, is_admin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users/:id/data', async (req, res) => {
  try {
    const userRes = await pool.query('SELECT balance FROM users WHERE id = $1', [req.params.id]);
    const betsRes = await pool.query('SELECT market_id, outcome, amount, payout FROM bets WHERE user_id = $1', [req.params.id]);
    
    // Transforma o array de apostas num objeto para pesquisa rápida no frontend
    const betsData = {};
    betsRes.rows.forEach(b => betsData[b.market_id] = b);
    
    res.json({ balance: userRes.rows[0].balance, bets: betsData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/markets', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM markets ORDER BY id DESC');
    const markets = result.rows.map(m => {
      const total = m.pool_a + m.pool_b;
      return { ...m, priceA: (m.pool_a / total).toFixed(2), priceB: (m.pool_b / total).toFixed(2) };
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
    
    const marketCheck = await pool.query('SELECT status FROM markets WHERE id = $1', [marketId]);
    if (marketCheck.rows[0].status !== 'OPEN') throw new Error('Mercado já encerrado!');

    const betCheck = await pool.query('SELECT id FROM bets WHERE user_id = $1 AND market_id = $2', [userId, marketId]);
    if (betCheck.rowCount > 0) throw new Error('Já apostaste neste mercado!');

    const userRes = await pool.query('SELECT balance FROM users WHERE id = $1', [userId]);
    if (userRes.rows[0].balance < amount) throw new Error('Saldo insuficiente');

    await pool.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amount, userId]);
    await pool.query('INSERT INTO bets (user_id, market_id, outcome, amount) VALUES ($1, $2, $3, $4)', [userId, marketId, outcome, amount]);
    
    const poolColumn = outcome === 'A' ? 'pool_a' : 'pool_b';
    await pool.query(`UPDATE markets SET ${poolColumn} = ${poolColumn} + $1 WHERE id = $2`, [amount, marketId]);
    
    await pool.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/markets', async (req, res) => {
  const { question, type } = req.body;
  try {
    await pool.query('INSERT INTO markets (question, type) VALUES ($1, $2)', [question, type]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/markets/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM bets WHERE market_id = $1', [req.params.id]);
    await pool.query('DELETE FROM markets WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NOVO: Rota para Resolver o Mercado e Distribuir Prémios
app.post('/api/admin/markets/:id/resolve', async (req, res) => {
  const marketId = req.params.id;
  const { winningOutcome } = req.body; // 'A' ou 'B'

  try {
    await pool.query('BEGIN');

    const marketRes = await pool.query('SELECT * FROM markets WHERE id = $1 AND status = $2', [marketId, 'OPEN']);
    if (marketRes.rowCount === 0) throw new Error('Mercado não encontrado ou já resolvido.');
    const market = marketRes.rows[0];

    // Atualiza estado do mercado
    await pool.query('UPDATE markets SET status = $1, winning_outcome = $2 WHERE id = $3', ['RESOLVED', winningOutcome, marketId]);

    // Lógica de Distribuição (Automated Market Maker)
    const totalPool = market.pool_a + market.pool_b;
    const winningPool = winningOutcome === 'A' ? market.pool_a : market.pool_b;

    // Vai buscar quem acertou
    const winningBets = await pool.query('SELECT * FROM bets WHERE market_id = $1 AND outcome = $2', [marketId, winningOutcome]);

    for (let bet of winningBets.rows) {
      // Cálculo: Aposta do utilizador * (Total em Jogo / Total Apostado na Opção Vencedora)
      // Exemplo: Apostou 10. Pool Vencedora tem 200. Pool total tem 1000. Paga: 10 * (1000/200) = 50 tokens ganhos.
      const payout = Math.floor(bet.amount * (totalPool / winningPool));
      
      // Entrega o saldo ao utilizador
      await pool.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [payout, bet.user_id]);
      
      // Regista o valor ganho na aposta para o frontend mostrar
      await pool.query('UPDATE bets SET payout = $1 WHERE id = $2', [payout, bet.id]);
    }

    await pool.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 6001;
app.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));