import React, { useState, useEffect, useCallback } from 'react';

const API_URL = '/api';

export default function ENDAMarket() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('enda_user');
    return saved ? JSON.parse(saved) : null;
  });
  
  // Agora userBets é um objeto: { marketId: { outcome, amount, payout } }
  const [userBets, setUserBets] = useState({}); 
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [betAmounts, setBetAmounts] = useState({});
  
  const [view, setView] = useState('market'); 
  const [newQuestion, setNewQuestion] = useState('');
  const [newType, setNewType] = useState('SIM_NAO');

  const fetchMarkets = () => {
    fetch(`${API_URL}/markets`).then(res => res.json()).then(setMarkets).catch(console.error);
  };

  const fetchUserData = useCallback(() => {
    if (!user) return;
    fetch(`${API_URL}/users/${user.id}/data`)
      .then(res => res.json())
      .then(data => {
        setUser(prev => ({ ...prev, balance: data.balance }));
        setUserBets(data.bets);
      })
      .catch(console.error);
  }, [user?.id]);

  useEffect(() => {
    if (user) {
      fetchMarkets();
      fetchUserData();
    }
  }, [user?.id, fetchUserData]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok) {
        setUser(data);
        localStorage.setItem('enda_user', JSON.stringify(data));
        if (data.is_admin) setView('admin');
      } else { alert(data.error); }
    } catch (err) { alert('Erro ao ligar ao servidor.'); }
    setLoading(false);
  };

  const handleLogout = () => {
    setUser(null);
    setUserBets({});
    localStorage.removeItem('enda_user');
    setView('market');
  };

  const handleBet = async (marketId, outcome) => {
    if (userBets[marketId]) return alert("Já fizeste uma aposta neste mercado!");
    
    const amount = Number(betAmounts[marketId]) || 0;
    if (amount <= 0) return alert("Insere um valor válido para apostar.");
    if (user.balance < amount) return alert("Tokens insuficientes!");

    try {
      // Previsão otimista na UI
      setUser({ ...user, balance: user.balance - amount });
      setUserBets({ ...userBets, [marketId]: { outcome, amount, payout: 0 } }); 

      const res = await fetch(`${API_URL}/bet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, marketId, outcome, amount })
      });
      if (res.ok) {
        fetchMarkets();
        setBetAmounts({ ...betAmounts, [marketId]: '' });
      } else {
        const data = await res.json();
        throw new Error(data.error || "Erro na aposta");
      }
    } catch (err) {
      alert(err.message);
      fetchUserData(); 
    }
  };

  const handleCreateMarket = async (e) => {
    e.preventDefault();
    await fetch(`${API_URL}/admin/markets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: newQuestion, type: newType })
    });
    setNewQuestion('');
    fetchMarkets();
  };

  const handleDeleteMarket = async (id) => {
    if(!window.confirm("Apagar este mercado?")) return;
    await fetch(`${API_URL}/admin/markets/${id}`, { method: 'DELETE' });
    fetchMarkets();
  };

  const handleResolveMarket = async (id, winningOutcome) => {
    if(!window.confirm("Certeza? Esta ação vai distribuir os tokens e fechar o mercado irreversivelmente!")) return;
    await fetch(`${API_URL}/admin/markets/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winningOutcome })
    });
    fetchMarkets();
    fetchUserData(); // Recarrega o saldo do admin caso ele tenha apostado
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 p-8 rounded-2xl shadow-xl w-full max-w-md border border-gray-700">
          <h1 className="text-3xl font-bold text-white text-center mb-8">ENDA <span className="text-blue-500">MARKET</span></h1>
          <form onSubmit={handleLogin} className="space-y-4">
            <input type="text" placeholder="Username" required value={username} onChange={e => setUsername(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500" />
            <input type="password" placeholder="Password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500" />
            <button disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg mt-4 transition">{loading ? 'A carregar...' : 'Entrar / Registar'}</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6 font-sans pb-20">
      <header className="flex justify-between items-center mb-8 border-b border-gray-700 pb-4 max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold tracking-tighter">ENDA <span className="text-blue-500">MARKET</span></h1>
        <div className="flex gap-4 items-center">
          {user.is_admin && (
            <button onClick={() => setView(view === 'admin' ? 'market' : 'admin')} className="text-sm bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg border border-gray-600 transition">
              {view === 'admin' ? 'Voltar às Apostas' : '⚙️ Backoffice'}
            </button>
          )}
          <div className="bg-gray-800 px-4 py-2 rounded-lg border border-blue-500 flex items-center gap-2">
            <span>👤 {user.username}</span>
            <span className="text-gray-500">|</span>
            <span className="font-bold text-green-400">💰 {user.balance}</span>
          </div>
          <button onClick={handleLogout} className="text-gray-500 hover:text-white text-sm">Sair</button>
        </div>
      </header>

      {/* DASHBOARD ADMIN */}
      {view === 'admin' && user.is_admin ? (
        <div className="max-w-6xl mx-auto bg-gray-800 p-8 rounded-2xl border border-gray-700 shadow-xl">
          <h2 className="text-2xl font-bold mb-6 text-blue-400">Criar Novo Mercado</h2>
          <form onSubmit={handleCreateMarket} className="flex gap-4 mb-10 bg-gray-900 p-4 rounded-xl border border-gray-700">
            <input type="text" placeholder="A pergunta do mercado..." required value={newQuestion} onChange={e => setNewQuestion(e.target.value)} className="flex-1 bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:border-blue-500" />
            <select value={newType} onChange={e => setNewType(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:border-blue-500">
              <option value="SIM_NAO">Sim / Não</option>
              <option value="UP_UNDER">Up / Under</option>
            </select>
            <button type="submit" className="bg-blue-600 hover:bg-blue-500 px-6 font-bold rounded-lg transition">+ Adicionar</button>
          </form>

          <div className="space-y-3">
            {markets.map(m => (
              <div key={m.id} className="flex justify-between items-center bg-gray-900 p-4 rounded-lg border border-gray-700">
                <div className="flex-1">
                  <span className="text-xs bg-gray-800 text-blue-400 px-2 py-1 rounded font-bold uppercase mr-3">{m.type.replace('_', ' / ')}</span>
                  <span className={m.status === 'RESOLVED' ? 'line-through text-gray-500' : ''}>{m.question}</span>
                </div>
                
                {/* LÓGICA DE RESOLUÇÃO DO ADMIN */}
                {m.status === 'OPEN' ? (
                  <div className="flex gap-2">
                    <button onClick={() => handleResolveMarket(m.id, 'A')} className="text-xs bg-green-600 hover:bg-green-500 px-3 py-1 rounded font-bold">Venceu {m.type === 'SIM_NAO' ? 'SIM' : 'UP'}</button>
                    <button onClick={() => handleResolveMarket(m.id, 'B')} className="text-xs bg-red-600 hover:bg-red-500 px-3 py-1 rounded font-bold">Venceu {m.type === 'SIM_NAO' ? 'NÃO' : 'UNDER'}</button>
                    <button onClick={() => handleDeleteMarket(m.id)} className="text-gray-400 hover:text-red-400 ml-4">🗑️</button>
                  </div>
                ) : (
                  <span className="text-green-500 font-bold text-sm bg-green-500/10 px-3 py-1 rounded border border-green-500">Encerrado: Ganhou {m.winning_outcome === 'A' ? (m.type === 'SIM_NAO' ? 'SIM' : 'UP') : (m.type === 'SIM_NAO' ? 'NÃO' : 'UNDER')}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (

        /* VISTA DO UTILIZADOR */
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">
          {markets.map((market) => {
            const myBet = userBets[market.id];
            const isSimNao = market.type === 'SIM_NAO';
            const labelA = isSimNao ? 'SIM ✅' : 'UP 📈';
            const labelB = isSimNao ? 'NÃO ❌' : 'UNDER 📉';

            return (
              <div key={market.id} className={`bg-gray-800 p-6 rounded-xl border transition shadow-lg flex flex-col justify-between ${myBet ? (market.status === 'RESOLVED' ? (myBet.outcome === market.winning_outcome ? 'border-yellow-400' : 'border-red-500 opacity-70') : 'border-green-500 opacity-90') : 'border-gray-700 hover:border-blue-500'}`}>
                <div>
                  <h2 className="text-lg font-medium mb-6 min-h-[3rem]">{market.question}</h2>
                </div>
                
                {/* ESTADOS DO MERCADO E DA APOSTA */}
                {market.status === 'RESOLVED' ? (
                  myBet ? (
                    myBet.outcome === market.winning_outcome ? (
                      <div className="bg-yellow-500/20 border border-yellow-400 text-yellow-400 font-bold text-center py-4 rounded-lg flex flex-col">
                        <span className="text-lg">🎉 GANHASTE!</span>
                        <span className="text-sm font-normal">Recebeste {myBet.payout} tokens (Apostaste {myBet.amount})</span>
                      </div>
                    ) : (
                      <div className="bg-red-900/30 border border-red-500 text-red-400 font-bold text-center py-4 rounded-lg flex flex-col">
                        <span className="text-lg">❌ PERDESTE</span>
                        <span className="text-sm font-normal">Ficaram {myBet.amount} tokens na mesa.</span>
                      </div>
                    )
                  ) : (
                    <div className="bg-gray-700 text-gray-400 font-bold text-center py-4 rounded-lg">
                      🔒 Mercado Encerrado
                    </div>
                  )
                ) : myBet ? (
                  <div className="bg-green-600/20 border border-green-500 text-green-400 font-bold text-center py-4 rounded-lg flex flex-col">
                    <span>Aposta Registada! 🎯</span>
                    <span className="text-sm font-normal mt-1 text-green-200">Apostaste {myBet.amount} no {myBet.outcome === 'A' ? labelA : labelB}</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <input type="number" min="1" placeholder="Quantos tokens?" value={betAmounts[market.id] || ''} onChange={(e) => setBetAmounts({...betAmounts, [market.id]: e.target.value})} className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm text-center focus:outline-none focus:border-blue-500" />
                    <div className="flex gap-3">
                      <button onClick={() => handleBet(market.id, 'A')} className="flex-1 bg-blue-600 hover:bg-blue-500 py-3 rounded-lg font-bold transition flex flex-col items-center">
                        {labelA}
                        <span className="text-xs font-normal opacity-80 mt-1">{Math.round(market.priceA * 100)}%</span>
                      </button>
                      <button onClick={() => handleBet(market.id, 'B')} className="flex-1 bg-purple-600 hover:bg-purple-500 py-3 rounded-lg font-bold transition flex flex-col items-center">
                        {labelB}
                        <span className="text-xs font-normal opacity-80 mt-1">{Math.round(market.priceB * 100)}%</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}