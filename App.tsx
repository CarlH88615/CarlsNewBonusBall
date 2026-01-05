
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Ball, DrawResult, AppState } from './types';
import { 
  TOTAL_BALLS, 
  PRICE_PER_BALL, 
  PRIZE_TARGET, 
  UNDER_TARGET_PRIZE, 
  Icons 
} from './constants';

const App: React.FC = () => {
  const getNextSaturday = (baseDate = new Date()) => {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + (6 - d.getDay() + 7) % 7);
    if (d.getDay() === 6 && d.getHours() >= 20) d.setDate(d.getDate() + 7);
    d.setHours(19, 45, 0, 0);
    return d;
  };

  const [supabaseConfig] = useState(() => ({ 
    url: 'https://fsazyqcgpxvgckgllwkw.supabase.co', 
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZzYXp5cWNncHh2Z2NrZ2xsd2t3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2Mzg0ODksImV4cCI6MjA4MzIxNDQ4OX0.qlLb8m3urY50iDTXjaO9y41lnHNVNWRiwEeO1_WXGqA' 
  }));

  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [quotaWarning, setQuotaWarning] = useState<string | null>(null);
  const [groundingSources, setGroundingSources] = useState<any[]>([]);
  const [announcementText, setAnnouncementText] = useState('');
  const [customWeeks, setCustomWeeks] = useState<number>(1);
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);
  const [showPassModal, setShowPassModal] = useState(false);
  const [newAdminPass, setNewAdminPass] = useState('');
  const lastProcessedAnnouncementId = useRef<string | null>(null);

  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem('bonus_ball_v8');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (!parsed.adminPassword) parsed.adminPassword = 'carl';
        if (!parsed.aiHistory) parsed.aiHistory = [];
        return parsed;
      } catch (e) { console.error(e); }
    }
    return {
      balls: Array.from({ length: TOTAL_BALLS }, (_, i) => ({ 
        number: i + 1, owner: null, paidUntil: new Date().toISOString()
      })),
      history: [],
      pricePerBall: PRICE_PER_BALL,
      currentRollover: 0,
      nextDrawDate: getNextSaturday().toISOString(),
      adminPassword: 'carl',
      lastAnnouncement: '',
      lastAnnouncementId: '',
      aiHistory: []
    };
  });

  const [followedBall, setFollowedBall] = useState<number | null>(() => {
    const saved = localStorage.getItem('followed_ball');
    return saved ? parseInt(saved) : null;
  });

  const [activeTab, setActiveTab] = useState<'players' | 'history' | 'stats'>('players');
  const [isAdmin, setIsAdmin] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginPass, setLoginPass] = useState('');
  const [selectedBall, setSelectedBall] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [winningBall, setWinningBall] = useState<number | null>(null);
  const [isFetchingResult, setIsFetchingResult] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(err => console.error(err));
    }
  }, []);

  useEffect(() => {
    if (state.lastAnnouncementId && state.lastAnnouncementId !== lastProcessedAnnouncementId.current) {
      lastProcessedAnnouncementId.current = state.lastAnnouncementId;
      if (Notification.permission === 'granted' && state.lastAnnouncement) {
        new Notification("Bonus Ball Update", {
          body: state.lastAnnouncement,
          icon: 'https://cdn-icons-png.flaticon.com/512/3551/3551525.png'
        });
      }
    }
  }, [state.lastAnnouncementId, state.lastAnnouncement]);

  useEffect(() => {
    setSupabase(createClient(supabaseConfig.url, supabaseConfig.key));
  }, [supabaseConfig]);

  useEffect(() => {
    if (!supabase) return;
    const loadFromCloud = async () => {
      setIsSyncing(true);
      try {
        const { data } = await supabase.from('bonus_ball_data').select('state').eq('id', 1).maybeSingle();
        if (data?.state) {
          setState(prev => ({
            ...data.state,
            adminPassword: data.state.adminPassword || prev.adminPassword || 'carl',
            aiHistory: data.state.aiHistory || prev.aiHistory || []
          }));
          if (!lastProcessedAnnouncementId.current) {
            lastProcessedAnnouncementId.current = data.state.lastAnnouncementId || 'initial';
          }
        }
      } catch (e) { console.error(e); } finally { setIsSyncing(false); }
    };
    loadFromCloud();

    const channel = supabase.channel('schema-db-changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bonus_ball_data' }, 
        (payload) => {
          if (payload.new.state) setState(payload.new.state);
        }
      ).subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase]);

  useEffect(() => {
    localStorage.setItem('bonus_ball_v8', JSON.stringify(state));
    if (!supabase || !isAdmin) return;
    const saveToCloud = async () => {
      setIsSyncing(true);
      try { await supabase.from('bonus_ball_data').upsert({ id: 1, state: state }); }
      catch (e) { console.error(e); } finally { setIsSyncing(false); }
    };
    const timer = setTimeout(saveToCloud, 2000);
    return () => clearTimeout(timer);
  }, [state, supabase, isAdmin]);

  const stats = useMemo(() => {
    const paidNext = state.balls.filter(b => b.owner && new Date(b.paidUntil) >= new Date(state.nextDrawDate));
    const collected = paidNext.length * state.pricePerBall;
    const isUnderThreshold = collected < PRIZE_TARGET;
    const basePrize = isUnderThreshold ? Math.min(collected, UNDER_TARGET_PRIZE) : PRIZE_TARGET;
    const nextPrize = basePrize + state.currentRollover;
    const charity = isUnderThreshold ? 0 : Math.max(0, collected - PRIZE_TARGET);
    return { collected, nextPrize, isUnderThreshold, charity };
  }, [state.balls, state.nextDrawDate, state.currentRollover]);

  const fetchResult = async () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) return;
    setIsFetchingResult(true);
    setQuotaWarning(null);
    try {
      const ai = new GoogleGenAI({ apiKey });
      const resp = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: "UK National Lottery Bonus Ball for the most recent Saturday? JSON: {\"number\": X}",
        config: { tools: [{ googleSearch: {} }] }
      });
      const chunks = resp.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks) setGroundingSources(chunks);
      const match = (resp.text || "").match(/\{.*?\}/);
      if (match) {
        const data = JSON.parse(match[0]);
        if (data.number) setWinningBall(data.number);
      }
    } catch (e: any) {
      if (e.message?.includes('429')) setQuotaWarning("Quota Resting (60s)");
    } finally { setIsFetchingResult(false); }
  };

  const fetchTenWeeks = async () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) return;
    setIsFetchingHistory(true);
    try {
      const ai = new GoogleGenAI({ apiKey });
      const resp = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: "List the last 10 UK National Lottery Bonus Ball numbers. Return ONLY a JSON array of objects with 'date' (DD/MM/YY) and 'number' (integer).",
        config: { tools: [{ googleSearch: {} }] }
      });
      const chunks = resp.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks) setGroundingSources(chunks);
      const match = (resp.text || "").match(/\[.*\]/s);
      if (match) {
        const history = JSON.parse(match[0]);
        setState(prev => ({ ...prev, aiHistory: history }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsFetchingHistory(false);
    }
  };

  const executeDraw = () => {
    if (!winningBall) return;
    const ball = state.balls.find(b => b.number === winningBall);
    const isPaid = ball && new Date(ball.paidUntil) >= new Date(state.nextDrawDate);
    
    let prize = 0, charity = 0, rolloverAdd = 0;
    if (ball?.owner) {
      if (isPaid) { prize = stats.nextPrize; charity = stats.charity; }
      else { prize = 0; charity = stats.collected; }
    } else {
      charity = stats.collected * 0.5;
      rolloverAdd = stats.collected * 0.5;
    }

    const result: DrawResult = {
      id: Date.now().toString(),
      winningNumber: winningBall,
      winnerName: isPaid ? ball!.owner : (ball?.owner ? "Unpaid" : "Unsold"),
      prizeMoney: prize,
      charityMoney: charity,
      rolloverMoney: rolloverAdd,
      date: new Date(state.nextDrawDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    };

    setState(prev => {
      const nextDate = getNextSaturday(new Date(prev.nextDrawDate));
      nextDate.setDate(nextDate.getDate() + 7);
      return {
        ...prev,
        history: [result, ...prev.history],
        currentRollover: isPaid ? 0 : (prev.currentRollover + rolloverAdd),
        nextDrawDate: nextDate.toISOString(),
        lastAnnouncement: `Draw Results: Number ${winningBall}! Winner: ${result.winnerName}`,
        lastAnnouncementId: Date.now().toString()
      };
    });
    setWinningBall(null);
  };

  const addWeeks = (weeks: number) => {
    if (!selectedBall) return;
    const b = state.balls.find(x => x.number === selectedBall)!;
    const currentPaidUntil = new Date(b.paidUntil);
    const referenceDate = currentPaidUntil > new Date(state.nextDrawDate) ? currentPaidUntil : new Date(state.nextDrawDate);
    referenceDate.setDate(referenceDate.getDate() + (weeks * 7));
    setState(p => ({...p, balls: p.balls.map(x => x.number === selectedBall ? {...x, paidUntil: referenceDate.toISOString()} : x)}));
  };

  const sendBroadcast = () => {
    if (!announcementText.trim()) return;
    setState(prev => ({
      ...prev,
      lastAnnouncement: announcementText,
      lastAnnouncementId: Date.now().toString()
    }));
    setAnnouncementText('');
  };

  const handleLogin = () => {
    if (loginPass === state.adminPassword) { setIsAdmin(true); setShowLogin(false); setLoginPass(''); }
    else alert("Invalid password");
  };

  const handleUpdatePassword = () => {
    if (!newAdminPass.trim()) return;
    setState(prev => ({ ...prev, adminPassword: newAdminPass }));
    setShowPassModal(false);
    setNewAdminPass('');
    alert("Admin password updated!");
  };

  const getBallColor = (num: number) => {
    if (num <= 9) return 'bg-[#FFD700] text-black';
    if (num <= 19) return 'bg-[#FF69B4] text-white';
    if (num <= 29) return 'bg-[#32CD32] text-black';
    if (num <= 39) return 'bg-[#1E90FF] text-white';
    if (num <= 49) return 'bg-[#FF4500] text-white';
    return 'bg-[#8A2BE2] text-white';
  };

  return (
    <div className="min-h-screen pb-96">
      <header className="glass sticky top-0 z-40 h-24 px-6 md:px-12 flex items-center justify-between shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg"><Icons.Trophy /></div>
          <div>
            <h1 className="font-black text-xl tracking-tighter">BONUS BALL <span className="text-indigo-400">DELUXE</span></h1>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${quotaWarning ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}></div>
              <span className="text-[9px] font-black uppercase opacity-60 tracking-widest">{quotaWarning ? 'Quota Resting' : 'AI Ready'}</span>
            </div>
          </div>
        </div>

        <nav className="hidden lg:flex items-center gap-2 bg-white/5 p-1 rounded-xl">
          <TabBtn active={activeTab === 'players'} onClick={() => setActiveTab('players')} label="The Board" />
          <TabBtn active={activeTab === 'history'} onClick={() => setActiveTab('history')} label="History" />
          <TabBtn active={activeTab === 'stats'} onClick={() => setActiveTab('stats')} label="Payout Logic" />
        </nav>

        <div className="flex items-center gap-4">
          <button onClick={() => Notification.requestPermission()} className="p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-colors">🔔</button>
          <div className="hidden sm:block text-right pr-6 border-r border-white/10">
            <p className="text-[9px] font-black uppercase opacity-40">Est. Jackpot</p>
            <p className={`text-2xl font-black ${stats.isUnderThreshold ? 'text-amber-400' : 'text-indigo-400'}`}>£{stats.nextPrize}</p>
          </div>
          <button onClick={() => isAdmin ? setIsAdmin(false) : setShowLogin(true)} className="px-6 py-3 rounded-xl bg-white/10 text-[10px] font-black hover:bg-white/20 transition-all border border-white/10 uppercase">
            {isAdmin ? 'LOCK ADMIN' : 'STAFF LOGIN'}
          </button>
        </div>
      </header>

      {state.lastAnnouncement && (
        <div className="max-w-7xl mx-auto px-6 mt-6">
          <div className="bg-indigo-600/20 border border-indigo-500/30 rounded-2xl p-4 flex items-center gap-4">
            <span className="animate-bounce">📣</span>
            <p className="text-sm font-bold text-indigo-200"><span className="opacity-50 uppercase text-[10px] mr-2">Alert:</span> {state.lastAnnouncement}</p>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto p-6 md:p-12 space-y-12">
        {activeTab === 'players' && (
          <div className="space-y-10">
            <div className="flex flex-col md:flex-row justify-between items-end gap-6">
              <div>
                <h2 className="text-4xl font-black tracking-tighter text-white flex items-center gap-3">The Grid {stats.isUnderThreshold && <span className="px-3 py-1 bg-amber-500/20 text-amber-400 text-[9px] font-black rounded-full border border-amber-500/20 uppercase">Small Pot</span>}</h2>
                <p className="text-slate-400 font-bold mt-2 italic opacity-60 uppercase text-xs tracking-widest">Next Draw: {new Date(state.nextDrawDate).toLocaleDateString('en-GB', { dateStyle: 'full' })}</p>
              </div>
              <div className="relative w-full md:w-80">
                <input type="text" placeholder="Search Players..." className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-6 text-sm outline-none focus:border-indigo-500" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                <span className="absolute left-4 top-1/2 -translate-y-1/2 opacity-30 text-lg">🔍</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
              {state.balls.filter(b => b.number.toString().includes(searchQuery) || b.owner?.toLowerCase().includes(searchQuery.toLowerCase())).map(ball => {
                const paid = ball.owner && new Date(ball.paidUntil) >= new Date(state.nextDrawDate);
                const isFollowed = followedBall === ball.number;
                return (
                  <button key={ball.number} onClick={() => setSelectedBall(ball.number)} className={`group relative h-48 rounded-[2.5rem] p-6 text-left flex flex-col justify-between transition-all duration-300 hover:-translate-y-2 ${isFollowed ? 'ring-4 ring-indigo-500' : ''} ${ball.owner ? (paid ? 'glass-card' : 'bg-rose-500/10 border border-rose-500/20') : 'glass hover:bg-white/10'}`}>
                    <div className="flex justify-between items-start">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-black shadow-lg transform group-hover:rotate-6 transition-transform ${getBallColor(ball.number)}`}>{ball.number}</div>
                      {isFollowed && <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_10px_#6366f1] animate-pulse"></div>}
                    </div>
                    <div>
                      <p className={`font-black truncate ${ball.owner ? (paid ? 'text-slate-900' : 'text-rose-400') : 'text-white/20 italic'}`}>{ball.owner || 'Vacant'}</p>
                      {ball.owner && <p className={`text-[9px] font-black uppercase tracking-widest mt-1 ${paid ? 'text-emerald-600' : 'text-rose-500'}`}>{paid ? 'PAID' : 'UNPAID'}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="max-w-4xl mx-auto space-y-16">
            <div className="space-y-8">
              <h2 className="text-3xl font-black tracking-tighter">Internal Draw Results</h2>
              <div className="grid gap-4">
                {state.history.length > 0 ? state.history.map(h => (
                  <div key={h.id} className="glass p-6 rounded-3xl flex items-center gap-6">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-black ${getBallColor(h.winningNumber)}`}>{h.winningNumber}</div>
                    <div className="flex-1">
                      <p className="text-[10px] font-black opacity-40 uppercase tracking-widest">{h.date}</p>
                      <p className="text-xl font-black text-white">{h.winnerName}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-black text-indigo-400">£{h.prizeMoney}</p>
                      {h.charityMoney > 0 && <p className="text-[9px] font-black text-emerald-500 uppercase tracking-tighter">£{h.charityMoney} Charity</p>}
                    </div>
                  </div>
                )) : <p className="text-center py-10 opacity-30 font-bold">No draws executed yet.</p>}
              </div>
            </div>

            <div className="space-y-8">
              <div className="flex justify-between items-center">
                <h2 className="text-3xl font-black tracking-tighter text-white">Official AI History (Last 10)</h2>
                <button onClick={fetchTenWeeks} disabled={isFetchingHistory} className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all">
                  {isFetchingHistory ? 'SEARCHING...' : '⚡ Sync AI History'}
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                {(state.aiHistory || []).map((item, i) => (
                  <div key={i} className="glass p-6 rounded-2xl flex flex-col items-center gap-2 border border-white/5">
                    <p className="text-[9px] font-black opacity-40 uppercase">{item.date}</p>
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-black ${getBallColor(item.number)}`}>{item.number}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="max-w-4xl mx-auto glass p-12 rounded-[3rem] space-y-12 border border-white/5">
            <h2 className="text-3xl font-black tracking-tighter">Payout Logic</h2>
            <div className="grid md:grid-cols-2 gap-10">
              <div className="space-y-6">
                <StatRow label="Current Sales" value={`£${stats.collected}`} />
                <StatRow label="Rollover Pot" value={`£${state.currentRollover.toFixed(2)}`} highlight />
                <StatRow label="Projected Charity" value={`£${stats.charity}`} success={stats.charity > 0} />
              </div>
              <div className={`p-10 rounded-3xl text-white shadow-2xl flex flex-col justify-center ${stats.isUnderThreshold ? 'bg-gradient-to-br from-amber-600 to-orange-700' : 'bg-gradient-to-br from-indigo-600 to-violet-800'}`}>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-60 mb-4">{stats.isUnderThreshold ? '⚠️ NDO MODE ACTIVE' : '✅ STANDARD PAYOUT'}</p>
                <p className="text-7xl font-black tracking-tighter mb-6">£{stats.nextPrize}</p>
                <p className="text-xs font-bold opacity-80 leading-relaxed italic">
                  {stats.isUnderThreshold ? "Under £80 collected: Winner takes 100% of sales (max £76) + rollover. Charity receives £0." : "Over £80 collected: Winner gets £80 + rollover. Remaining balance to charity."}
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {isAdmin && (
        <footer className="fixed bottom-0 left-0 right-0 glass-card p-6 z-40 animate-slide-up border-t-2 border-indigo-400">
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col xl:flex-row items-center justify-between gap-6 border-b border-slate-200 pb-6">
              <div className="flex flex-wrap items-center justify-center gap-6">
                <div className="flex items-center gap-3 bg-slate-100 p-2 rounded-2xl border border-slate-200">
                  <span className="text-[9px] font-black uppercase opacity-50 ml-2">Draw Date:</span>
                  <input type="date" className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold outline-none text-slate-900" value={new Date(state.nextDrawDate).toISOString().split('T')[0]} onChange={e => {
                    const date = new Date(e.target.value);
                    date.setHours(19, 45, 0, 0);
                    setState(p => ({...p, nextDrawDate: date.toISOString()}));
                  }} />
                </div>
                <div className="flex items-center gap-3 bg-slate-100 p-2 rounded-2xl border border-slate-200">
                  <span className="text-[9px] font-black uppercase opacity-50 ml-2">Win No:</span>
                  <input type="number" className="w-16 bg-white border border-slate-200 rounded-xl px-2 py-2 text-center text-lg font-black text-slate-900" value={winningBall || ''} onChange={e => setWinningBall(parseInt(e.target.value) || null)} />
                  <button onClick={fetchResult} disabled={isFetchingResult} className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-xl text-[9px] font-black uppercase disabled:opacity-50">
                    {isFetchingResult ? '...' : '⚡ AI Sync'}
                  </button>
                </div>
                <button onClick={executeDraw} disabled={!winningBall} className="bg-indigo-600 text-white px-10 py-4 rounded-2xl font-black text-[10px] uppercase hover:bg-indigo-700 shadow-xl disabled:opacity-50">Finalize Result</button>
              </div>

              <div className="flex items-center gap-3 bg-indigo-50 p-2 rounded-2xl border border-indigo-100 w-full xl:w-auto">
                <input type="text" placeholder="Send Notification Alert..." className="flex-1 xl:w-64 bg-white border border-indigo-200 rounded-xl px-4 py-2 text-sm font-medium outline-none text-slate-900" value={announcementText} onChange={e => setAnnouncementText(e.target.value)} />
                <button onClick={sendBroadcast} className="px-6 py-2 bg-indigo-600 text-white rounded-xl text-[9px] font-black uppercase">Broadcast</button>
                <button onClick={() => setShowPassModal(true)} className="p-2 text-indigo-400 hover:text-indigo-600" title="Security Settings">⚙️</button>
              </div>
            </div>

            {groundingSources.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-4">
                <p className="text-[8px] font-black uppercase opacity-40">Verification Links:</p>
                {groundingSources.map((chunk, i) => chunk.web && (
                  <a key={i} href={chunk.web.uri} target="_blank" rel="noopener noreferrer" className="text-[8px] text-indigo-600 underline font-bold truncate max-w-[150px]">{chunk.web.title || 'Source'}</a>
                ))}
              </div>
            )}
          </div>
        </footer>
      )}

      {selectedBall && (
        <>
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[50]" onClick={() => setSelectedBall(null)}></div>
          <div className="fixed bottom-0 left-0 right-0 md:top-0 md:right-0 md:left-auto md:w-[450px] bg-white z-[60] shadow-2xl rounded-t-3xl md:rounded-l-3xl md:rounded-tr-none animate-slide-up flex flex-col max-h-[90vh]">
            <div className="p-10 flex items-center justify-between border-b border-slate-100">
              <div className="flex items-center gap-4">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl font-black ${getBallColor(selectedBall)}`}>{selectedBall}</div>
                <h3 className="text-3xl font-black tracking-tighter text-slate-800">Ball #{selectedBall}</h3>
              </div>
              <button onClick={() => setSelectedBall(null)} className="p-3 text-slate-400 hover:text-slate-800 transition-colors">✕</button>
            </div>
            
            <div className="p-10 flex-1 overflow-y-auto space-y-10">
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Player Name</label>
                {isAdmin ? (
                  <input type="text" className="w-full text-2xl font-black bg-slate-50 border border-slate-200 rounded-2xl p-6 focus:border-indigo-600 outline-none text-slate-900 placeholder:text-slate-300" value={state.balls.find(b => b.number === selectedBall)?.owner || ''} placeholder="Add player name..." onChange={e => setState(p => ({...p, balls: p.balls.map(b => b.number === selectedBall ? {...b, owner: e.target.value || null} : b)}))} />
                ) : (
                  <p className="text-4xl font-black text-slate-800 tracking-tighter">{state.balls.find(b => b.number === selectedBall)?.owner || 'Available'}</p>
                )}
              </div>
              
              {state.balls.find(b => b.number === selectedBall)?.owner && (
                <div className="space-y-8">
                  <div className={`p-8 rounded-2xl border-2 ${new Date(state.balls.find(b => b.number === selectedBall)!.paidUntil) >= new Date(state.nextDrawDate) ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-700'}`}>
                    <p className="text-[10px] font-black uppercase opacity-60 mb-2 tracking-widest">Account Status</p>
                    <p className="text-2xl font-black tracking-tight">{new Date(state.balls.find(b => b.number === selectedBall)!.paidUntil) >= new Date(state.nextDrawDate) ? 'PAID & ACTIVE' : 'PAYMENT DUE'}</p>
                    <p className="text-xs opacity-60 mt-1 italic font-medium">Paid through {new Date(state.balls.find(b => b.number === selectedBall)!.paidUntil).toLocaleDateString('en-GB')}</p>
                  </div>
                  
                  <button onClick={() => setFollowedBall(followedBall === selectedBall ? null : selectedBall)} className={`w-full py-5 rounded-2xl font-black text-xs uppercase tracking-widest transition-all border-2 ${followedBall === selectedBall ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100'}`}>
                    {followedBall === selectedBall ? '★ BALL PINNED' : '☆ PIN TO DASHBOARD'}
                  </button>
                  
                  {isAdmin && (
                    <div className="pt-8 border-t border-slate-100 space-y-6">
                      <div className="space-y-3">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Manual Adjustment (Weeks)</label>
                        <div className="flex gap-2">
                          <input type="number" min="1" className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-900 outline-none focus:border-indigo-600" value={customWeeks} onChange={e => setCustomWeeks(parseInt(e.target.value) || 1)} />
                          <button onClick={() => addWeeks(customWeeks)} className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase shadow-lg shadow-indigo-200">Add Weeks</button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <button onClick={() => addWeeks(1)} className="py-4 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase hover:bg-black transition-colors shadow-lg shadow-slate-200">+1 Week</button>
                        <button onClick={() => addWeeks(4)} className="py-4 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase hover:bg-black transition-colors shadow-lg shadow-slate-200">+4 Weeks</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {showLogin && (
        <div className="fixed inset-0 bg-slate-950/95 z-[100] flex items-center justify-center p-8 backdrop-blur-xl">
          <div className="glass p-12 rounded-[3rem] w-full max-w-md space-y-8 border-white/10 shadow-2xl">
            <h3 className="text-3xl font-black text-center tracking-tighter text-white">Staff Gateway</h3>
            <input autoFocus type="password" className="w-full bg-white/5 border-2 border-white/10 rounded-2xl p-6 text-center text-4xl font-black outline-none focus:border-indigo-500 text-white" placeholder="••••" value={loginPass} onChange={e => setLoginPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            <div className="flex gap-4">
              <button onClick={() => setShowLogin(false)} className="flex-1 py-4 font-black text-xs uppercase text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={handleLogin} className="flex-1 py-4 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-600/20">Authorize</button>
            </div>
          </div>
        </div>
      )}

      {showPassModal && (
        <div className="fixed inset-0 bg-slate-950/95 z-[110] flex items-center justify-center p-8 backdrop-blur-xl">
          <div className="glass p-12 rounded-[3rem] w-full max-w-md space-y-8 border-white/10 shadow-2xl">
            <h3 className="text-3xl font-black text-center tracking-tighter text-white">Security Settings</h3>
            <div className="space-y-4">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">New Admin Password</label>
              <input autoFocus type="text" className="w-full bg-white/5 border-2 border-white/10 rounded-2xl p-6 text-center text-2xl font-black outline-none focus:border-indigo-500 text-white" placeholder="New Secret..." value={newAdminPass} onChange={e => setNewAdminPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleUpdatePassword()} />
            </div>
            <div className="flex gap-4">
              <button onClick={() => setShowPassModal(false)} className="flex-1 py-4 font-black text-xs uppercase text-slate-400 hover:text-white transition-colors">Close</button>
              <button onClick={handleUpdatePassword} className="flex-1 py-4 bg-rose-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-xl shadow-rose-600/20">Update Password</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const TabBtn: React.FC<{ active: boolean, onClick: () => void, label: string }> = ({ active, onClick, label }) => (
  <button onClick={onClick} className={`px-8 py-3 rounded-lg text-[10px] font-black transition-all ${active ? 'bg-indigo-600 text-white shadow-xl' : 'text-slate-400 hover:text-white'}`}>{label}</button>
);

const StatRow: React.FC<{ label: string, value: string, highlight?: boolean, success?: boolean }> = ({ label, value, highlight, success }) => (
  <div className="flex justify-between items-center py-4 border-b border-white/5">
    <span className="text-[10px] font-black uppercase opacity-40 tracking-widest">{label}</span>
    <span className={`text-xl font-black ${highlight ? 'text-rose-500' : (success ? 'text-emerald-500' : 'text-white')}`}>{value}</span>
  </div>
);

export default App;
