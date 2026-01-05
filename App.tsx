
import React, { useState, useEffect, useMemo } from 'react';
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

interface ExternalLottoResult {
  date: string;
  number: number;
}

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

  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem('bonus_ball_v5');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!parsed.adminPassword) parsed.adminPassword = 'carl';
      return parsed;
    }
    return {
      balls: Array.from({ length: TOTAL_BALLS }, (_, i) => ({ 
        number: i + 1, 
        owner: null,
        paidUntil: new Date().toISOString()
      })),
      history: [],
      pricePerBall: PRICE_PER_BALL,
      currentRollover: 0,
      nextDrawDate: getNextSaturday().toISOString(),
      adminPassword: 'carl'
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
  const [externalResults, setExternalResults] = useState<ExternalLottoResult[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const client = createClient(supabaseConfig.url, supabaseConfig.key);
    setSupabase(client);
  }, [supabaseConfig]);

  useEffect(() => {
    if (!supabase) return;
    const loadFromCloud = async () => {
      setIsSyncing(true);
      try {
        const { data, error } = await supabase.from('bonus_ball_data').select('state').eq('id', 1).maybeSingle();
        if (!error && data?.state && Object.keys(data.state).length > 0) {
          setState(data.state);
        }
      } catch (e) {
        console.error("Cloud Load Failed", e);
      } finally {
        setIsSyncing(false);
      }
    };
    loadFromCloud();
  }, [supabase]);

  useEffect(() => {
    localStorage.setItem('bonus_ball_v5', JSON.stringify(state));
    if (!supabase || !isAdmin) return;
    
    const saveToCloud = async () => {
      setIsSyncing(true);
      try {
        await supabase.from('bonus_ball_data').upsert({ id: 1, state: state });
      } catch (e) {
        console.error("Cloud Save Failed", e);
      } finally {
        setIsSyncing(false);
      }
    };
    const timer = setTimeout(saveToCloud, 2000);
    return () => clearTimeout(timer);
  }, [state, supabase, isAdmin]);

  useEffect(() => {
    if (followedBall) localStorage.setItem('followed_ball', followedBall.toString());
    else localStorage.removeItem('followed_ball');
  }, [followedBall]);

  useEffect(() => {
    fetchHistory();
  }, []);

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  const getBallColor = (num: number) => {
    if (num <= 9) return 'bg-[#FFD700]';
    if (num <= 19) return 'bg-[#FF69B4]';
    if (num <= 29) return 'bg-[#32CD32]';
    if (num <= 39) return 'bg-[#1E90FF]';
    if (num <= 49) return 'bg-[#FF4500]';
    return 'bg-[#8A2BE2]';
  };

  const isPaidForNextDraw = (ball: Ball) => {
    if (!ball.owner) return false;
    return new Date(ball.paidUntil) >= new Date(state.nextDrawDate);
  };

  const stats = useMemo(() => {
    const assigned = state.balls.filter(b => b.owner);
    const paidNext = state.balls.filter(b => isPaidForNextDraw(b));
    const collectedForNext = paidNext.length * state.pricePerBall;
    
    let basePrize = 0;
    const isUnderThreshold = collectedForNext < PRIZE_TARGET;
    
    if (!isUnderThreshold) {
      basePrize = PRIZE_TARGET;
    } else {
      basePrize = Math.min(collectedForNext, UNDER_TARGET_PRIZE);
    }
    const nextPrize = basePrize + state.currentRollover;

    return { assigned, paidNext, collectedForNext, nextPrize, isUnderThreshold };
  }, [state.balls, state.nextDrawDate, state.currentRollover]);

  const fetchHistory = async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const resp = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: "List the UK National Lottery Bonus Ball numbers for the last 10 Saturday draws. Format as JSON array: [ { 'date': 'DD/MM/YYYY', 'number': X } ]. Return ONLY JSON array.",
        config: { tools: [{ googleSearch: {} }] }
      });
      const text = resp.text || "";
      const jsonStr = text.substring(text.indexOf('['), text.lastIndexOf(']') + 1);
      setExternalResults(JSON.parse(jsonStr));
    } catch (e) {
      console.error("Failed to fetch history", e);
    }
  };

  const fetchResult = async () => {
    setIsFetchingResult(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const resp = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: "What was the UK National Lottery Bonus Ball number for the most recent Saturday draw? Return only the number in JSON format: {\"number\": 23}",
        config: { tools: [{ googleSearch: {} }] }
      });
      const match = (resp.text || "").match(/\{.*?\}/);
      if (match) {
        const data = JSON.parse(match[0]);
        if (data.number) setWinningBall(data.number);
      }
    } catch (e) {
      console.error("Failed to fetch latest result", e);
    } finally {
      setIsFetchingResult(false);
    }
  };

  const addPayment = (num: number, weeks: number) => {
    setState(prev => ({
      ...prev,
      balls: prev.balls.map(b => {
        if (b.number === num) {
          const nextDraw = new Date(prev.nextDrawDate);
          const currentPaidUntil = new Date(b.paidUntil);
          const baseDate = currentPaidUntil > nextDraw ? currentPaidUntil : nextDraw;
          const newDate = new Date(baseDate);
          newDate.setDate(newDate.getDate() + (weeks * 7));
          return { ...b, paidUntil: newDate.toISOString() };
        }
        return b;
      })
    }));
  };

  const executeDraw = () => {
    if (!winningBall) return;
    const ball = state.balls.find(b => b.number === winningBall);
    const isPaid = ball ? isPaidForNextDraw(ball) : false;
    let prize = 0;
    let charity = 0;
    let rolloverAdd = 0;

    if (ball?.owner) {
      if (isPaid) {
        if (stats.collectedForNext >= PRIZE_TARGET) {
          prize = PRIZE_TARGET + state.currentRollover;
          charity = stats.collectedForNext - PRIZE_TARGET;
        } else {
          // If < 80, winner takes up to 76. Any tiny surplus above 76 still goes to charity.
          prize = Math.min(stats.collectedForNext, UNDER_TARGET_PRIZE) + state.currentRollover;
          charity = Math.max(0, stats.collectedForNext - Math.min(stats.collectedForNext, UNDER_TARGET_PRIZE));
        }
      } else {
        prize = 0;
        charity = stats.collectedForNext;
      }
    } else {
      charity = stats.collectedForNext * 0.5;
      rolloverAdd = stats.collectedForNext * 0.5;
    }

    const result: DrawResult = {
      id: Date.now().toString(),
      winningNumber: winningBall,
      winnerName: isPaid ? ball!.owner : (ball?.owner ? "Unpaid Player" : "No Owner"),
      prizeMoney: prize,
      charityMoney: charity,
      rolloverMoney: rolloverAdd,
      date: formatDate(state.nextDrawDate)
    };

    setState(prev => {
      const nextDate = getNextSaturday(new Date(prev.nextDrawDate));
      nextDate.setDate(nextDate.getDate() + 7);
      return {
        ...prev,
        history: [result, ...prev.history],
        currentRollover: isPaid ? 0 : (prev.currentRollover + rolloverAdd),
        nextDrawDate: nextDate.toISOString()
      };
    });
    setWinningBall(null);
  };

  const handleLogin = () => {
    if (loginPass === state.adminPassword) {
      setIsAdmin(true);
      setShowLogin(false);
      setLoginPass('');
    } else {
      alert('Access Denied');
    }
  };

  const filteredBalls = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return state.balls.filter(b => 
      b.number.toString().includes(q) || 
      (b.owner?.toLowerCase().includes(q))
    );
  }, [state.balls, searchQuery]);

  return (
    <div className="min-h-screen bg-[#f1f5f9] text-slate-900 pb-32 selection:bg-indigo-100">
      <header className="bg-white/80 backdrop-blur-2xl border-b border-slate-200 sticky top-0 z-40 h-20 px-4 md:px-10 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-xl shadow-indigo-200">
            <Icons.Trophy />
          </div>
          <div>
            <h1 className="font-black text-xl tracking-tight leading-none text-slate-800">Bonus Ball</h1>
            <div className="flex items-center gap-2 mt-1.5">
              <div className={`w-2 h-2 rounded-full ${isSyncing ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`}></div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {isSyncing ? 'Syncing...' : 'Live System'}
              </span>
            </div>
          </div>
          
          <nav className="hidden lg:flex items-center gap-1 ml-10 bg-slate-100 p-1 rounded-2xl">
            <TabButton active={activeTab === 'players'} onClick={() => setActiveTab('players')} label="The Board" />
            <TabButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} label="Winners" />
            <TabButton active={activeTab === 'stats'} onClick={() => setActiveTab('stats')} label="Draw Rules" />
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right flex flex-col items-end pr-6 border-r border-slate-100 hidden sm:flex">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-tighter">Est. Prize</p>
            <p className={`font-black text-2xl leading-none ${stats.isUnderThreshold ? 'text-amber-500' : 'text-indigo-600'}`}>
              £{stats.nextPrize}
            </p>
          </div>
          <button 
            onClick={() => isAdmin ? setIsAdmin(false) : setShowLogin(true)}
            className={`px-6 py-3 rounded-2xl text-[10px] font-black transition-all ${isAdmin ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-100' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 shadow-sm'}`}
          >
            {isAdmin ? 'ADMIN ACTIVE' : 'ADMIN LOGIN'}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-10">
        {activeTab === 'players' && (
          <div className="space-y-12">
            {externalResults.length > 0 && (
              <section className="bg-white border border-slate-200 p-8 rounded-[3rem] shadow-sm relative overflow-hidden group">
                 <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Icons.History />
                 </div>
                 <div className="flex items-center gap-3 mb-8 border-b border-slate-50 pb-5">
                    <span className="text-2xl">⚡</span>
                    <h2 className="text-lg font-black text-slate-800 tracking-tight">Recent Official Results</h2>
                 </div>
                 <div className="flex gap-6 overflow-x-auto pb-6 scrollbar-hide -mx-4 px-4">
                    {externalResults.slice(0, 8).map((res, i) => (
                      <div key={res.date} className="bg-slate-50 border border-slate-100 p-6 rounded-[2.5rem] text-center min-w-[150px] hover:bg-white hover:shadow-xl transition-all duration-300">
                        <p className="text-[10px] font-bold text-slate-400 mb-4">{res.date}</p>
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-black text-white shadow-lg mx-auto transform transition-transform group-hover:scale-105 ${getBallColor(res.number)}`}>
                          {res.number}
                        </div>
                        {i === 0 && <div className="mt-4 inline-block px-3 py-1 bg-emerald-100 text-emerald-600 text-[8px] font-black rounded-full uppercase tracking-widest">Latest</div>}
                      </div>
                    ))}
                 </div>
              </section>
            )}

            <div className="flex flex-col md:flex-row justify-between items-end gap-6 px-2">
              <div className="w-full md:w-auto">
                <div className="flex items-center gap-3">
                  <h2 className="text-4xl font-black text-slate-800 tracking-tight">The Player Board</h2>
                  {stats.isUnderThreshold && (
                    <div className="bg-amber-100 text-amber-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest animate-pulse">Small Pot</div>
                  )}
                </div>
                <p className="text-sm font-bold text-slate-400 mt-2">Next Saturday: {formatDate(state.nextDrawDate)}</p>
              </div>
              <div className="relative w-full md:w-96 group">
                <input 
                  type="text" 
                  placeholder="Filter players or numbers..."
                  className="w-full pl-12 pr-6 py-4 bg-white border border-slate-200 rounded-[1.5rem] text-sm font-bold focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 outline-none shadow-sm transition-all"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <span className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-indigo-500 transition-colors">🔍</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-8">
              {filteredBalls.map(ball => {
                const paid = isPaidForNextDraw(ball);
                const isFollowed = followedBall === ball.number;
                return (
                  <button 
                    key={ball.number}
                    onClick={() => setSelectedBall(ball.number)}
                    className={`group p-6 md:p-8 rounded-[3rem] border-2 transition-all duration-300 text-left flex flex-col gap-4 relative h-56 overflow-hidden ${
                      isFollowed ? 'ring-4 ring-indigo-500/30' : ''
                    } ${
                      ball.owner 
                        ? paid 
                          ? 'bg-white border-white hover:border-indigo-300 shadow-md hover:shadow-2xl hover:-translate-y-2' 
                          : 'bg-rose-50 border-rose-100 hover:border-rose-300'
                        : 'bg-slate-50 border-dashed border-slate-300 hover:bg-white hover:border-indigo-300'
                    }`}
                  >
                    <div className="absolute -right-4 -top-4 w-16 h-16 bg-slate-50 rounded-full opacity-50 group-hover:scale-150 transition-transform"></div>
                    
                    <div className="flex justify-between items-start z-10">
                      <span className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black text-white shadow-2xl transition-all duration-300 group-hover:rotate-12 ${getBallColor(ball.number)}`}>
                        {ball.number}
                      </span>
                      {isFollowed && (
                        <div className="bg-indigo-600 text-white p-2 rounded-xl text-[9px] font-black px-3 uppercase shadow-lg animate-bounce">MINE</div>
                      )}
                    </div>

                    <div className="mt-auto z-10">
                      <p className={`font-black text-lg leading-tight truncate ${ball.owner ? 'text-slate-800' : 'text-slate-300 italic font-bold'}`}>
                        {ball.owner || 'Open Slot'}
                      </p>
                      {ball.owner && (
                        <div className="flex items-center gap-2 mt-2">
                          <div className={`w-2.5 h-2.5 rounded-full ${paid ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.5)] animate-pulse'}`}></div>
                          <span className={`text-[10px] font-black uppercase tracking-widest ${paid ? 'text-slate-400' : 'text-rose-600'}`}>
                            {paid ? 'Paid' : 'Due'}
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="max-w-4xl mx-auto space-y-12">
            <h2 className="text-4xl font-black text-slate-800 tracking-tight text-center">Hall of Winners</h2>
            <div className="grid gap-6">
              {state.history.length === 0 ? (
                <div className="text-center py-32 bg-white rounded-[4rem] border-4 border-dashed border-slate-100">
                   <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6 text-slate-200">
                     <Icons.Trophy />
                   </div>
                   <p className="text-slate-400 font-black uppercase tracking-widest text-sm">No winners recorded yet</p>
                </div>
              ) : (
                state.history.map((h, i) => (
                  <div key={h.id} className={`bg-white border border-slate-100 p-8 rounded-[3rem] shadow-sm flex items-center gap-8 group hover:shadow-xl transition-all duration-300 ${i === 0 ? 'ring-2 ring-indigo-600 shadow-indigo-50 scale-105 my-4' : ''}`}>
                    <div className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl font-black text-white shadow-2xl flex-shrink-0 group-hover:scale-110 transition-transform ${getBallColor(h.winningNumber)}`}>
                      {h.winningNumber}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{h.date}</span>
                        {i === 0 && <span className="bg-indigo-600 text-white text-[8px] font-black px-2 py-0.5 rounded-full">LATEST</span>}
                      </div>
                      <p className="font-black text-2xl text-slate-800">{h.winnerName}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-black text-indigo-600">£{h.prizeMoney}</p>
                      {h.charityMoney > 0 && <p className="text-[11px] font-black text-emerald-500 uppercase mt-1">£{h.charityMoney} to Charity</p>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="max-w-4xl mx-auto space-y-12">
             <div className="bg-white p-12 md:p-16 rounded-[4rem] border border-slate-200 shadow-sm relative overflow-hidden">
                <div className="absolute -right-20 -top-20 w-64 h-64 bg-slate-50 rounded-full"></div>
                <h3 className="text-3xl font-black text-slate-800 mb-12 relative z-10">Pot Status</h3>
                <div className="space-y-10 relative z-10">
                   <div className="flex justify-between items-center px-4">
                      <span className="text-sm font-black text-slate-400 uppercase tracking-widest">Total Collected</span>
                      <span className="text-2xl font-black text-slate-800">£{stats.collectedForNext}</span>
                   </div>
                   <div className="flex justify-between items-center px-4">
                      <span className="text-sm font-black text-slate-400 uppercase tracking-widest">Previous Rollover</span>
                      <span className={`text-2xl font-black ${state.currentRollover > 0 ? 'text-rose-600' : 'text-slate-800'}`}>£{state.currentRollover.toFixed(2)}</span>
                   </div>
                   <div className="h-px bg-slate-100"></div>
                   <div className={`p-12 rounded-[3.5rem] shadow-2xl transition-all duration-500 text-white relative overflow-hidden ${stats.isUnderThreshold ? 'bg-amber-500 shadow-amber-200' : 'bg-indigo-600 shadow-indigo-200'}`}>
                      <div className="absolute top-6 right-8 opacity-20 scale-150 rotate-12"><Icons.Trophy /></div>
                      <span className="text-[11px] font-black uppercase tracking-[0.2em] opacity-80 mb-4 block">
                        {stats.isUnderThreshold ? '⚠️ Limited Draw' : '✅ Standard Draw'}
                      </span>
                      <div className="flex items-baseline gap-4">
                        <span className="text-7xl font-black">£{stats.nextPrize}</span>
                        {state.currentRollover > 0 && <span className="bg-white/20 px-4 py-1 rounded-full text-[11px] font-black animate-pulse uppercase">ROLL</span>}
                      </div>
                      <div className={`mt-10 p-6 rounded-3xl flex items-center gap-5 border ${stats.isUnderThreshold ? 'bg-black/10 border-white/20' : 'bg-white/10 border-white/20'}`}>
                        <div className="text-3xl">{stats.isUnderThreshold ? '📉' : '🎯'}</div>
                        <p className="text-xs font-bold leading-relaxed opacity-90">
                          {stats.isUnderThreshold 
                            ? "Collection is below £80. Winner takes the whole pot (Capped at £76) plus rollover. Charity gets £0 this week." 
                            : "Target met! Winner takes £80 guaranteed plus any rollover. Everything else goes to Charity."}
                        </p>
                      </div>
                   </div>
                </div>
             </div>
             <div className="bg-slate-900 p-12 rounded-[3.5rem] text-white shadow-2xl">
                <h3 className="text-2xl font-black mb-12 flex items-center gap-4">
                  <span className="w-1.5 h-10 bg-indigo-500 rounded-full"></span>
                  Official Rules
                </h3>
                <div className="grid gap-8">
                  <RuleItem icon="✓" title="Collection £80+" desc="Winner gets £80 + Rollover. Charity gets everything remaining in the pot." />
                  <RuleItem icon="⚠️" title="Collection < £80" desc="Charity is paused. Winner gets 100% of collection (Max £76) + Rollover." />
                  <RuleItem icon="🔥" title="Unsold Winner" desc="50% to Charity, 50% to Rollover. Prize builds for next week." />
                  <RuleItem icon="🛡️" title="Unpaid Owner" desc="If owner hasn't paid, the prize is forfeited and 100% goes to Charity." />
                </div>
             </div>
          </div>
        )}
      </main>

      {isAdmin && (
        <footer className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-2xl border-t border-slate-200 p-6 z-40 flex flex-col md:flex-row items-center justify-center gap-8 md:gap-16 animate-slide-up shadow-[0_-20px_40px_rgba(0,0,0,0.05)]">
           <div className="flex items-center gap-6">
              <span className="text-[11px] font-black uppercase text-slate-400 tracking-widest">Commit Result:</span>
              <div className="flex gap-4">
                <input 
                  type="number" 
                  className="w-24 border-4 border-slate-100 rounded-2xl p-4 font-black text-center text-3xl outline-none focus:border-indigo-600 bg-slate-50 shadow-inner"
                  placeholder="##"
                  value={winningBall || ''}
                  onChange={(e) => setWinningBall(parseInt(e.target.value) || null)}
                />
                <button 
                  onClick={fetchResult} 
                  disabled={isFetchingResult}
                  className="px-6 py-2 bg-slate-100 rounded-2xl text-[10px] font-black hover:bg-slate-200 transition-all uppercase tracking-widest flex items-center gap-2"
                >
                  {isFetchingResult ? 'Fetching...' : '⚡ AI Fetch'}
                </button>
              </div>
           </div>
           <button 
             onClick={executeDraw} 
             disabled={!winningBall}
             className="bg-indigo-600 text-white px-12 py-6 rounded-[2rem] font-black text-[12px] uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-2xl shadow-indigo-100 disabled:opacity-50 transform hover:scale-105 active:scale-95"
           >
             Finalize Draw Results
           </button>
        </footer>
      )}

      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-2xl border-t border-slate-200 h-24 flex items-stretch z-40 px-6 pb-6 shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
        <MobileNavLink icon={<Icons.Users />} label="Board" active={activeTab === 'players'} onClick={() => setActiveTab('players')} />
        <MobileNavLink icon={<Icons.History />} label="Wins" active={activeTab === 'history'} onClick={() => setActiveTab('history')} />
        <MobileNavLink icon={<Icons.TrendUp />} label="Rules" active={activeTab === 'stats'} onClick={() => setActiveTab('stats')} />
      </nav>

      {selectedBall && (
        <>
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[50] animate-in fade-in" onClick={() => setSelectedBall(null)}></div>
          <div className="fixed bottom-0 left-0 right-0 md:top-0 md:right-0 md:left-auto md:w-[500px] bg-white z-[60] shadow-2xl rounded-t-[4rem] md:rounded-l-[4rem] md:rounded-tr-none animate-slide-up flex flex-col max-h-[95vh] md:max-h-screen overflow-hidden">
            <div className="p-10 md:p-14 border-b border-slate-50 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-6">
                <div className={`w-20 h-20 rounded-[2.25rem] flex items-center justify-center text-white text-4xl font-black shadow-2xl transform rotate-3 ${getBallColor(selectedBall)}`}>
                  {selectedBall}
                </div>
                <h3 className="text-4xl font-black text-slate-800 tracking-tight">Ball #{selectedBall}</h3>
              </div>
              <button onClick={() => setSelectedBall(null)} className="p-4 text-slate-300 hover:text-slate-900 transition-all text-3xl">✕</button>
            </div>
            <div className="p-10 md:p-14 flex-1 overflow-y-auto space-y-12 scrollbar-hide pb-40">
              <div className="space-y-4">
                <label className="text-[11px] font-black uppercase text-slate-400 tracking-[0.2em] pl-2">Ownership</label>
                {isAdmin ? (
                  <input 
                    type="text" 
                    className="w-full text-3xl font-black border-4 border-slate-50 bg-slate-50 rounded-[2rem] p-8 focus:border-indigo-600 focus:bg-white outline-none transition-all"
                    value={state.balls.find(b => b.number === selectedBall)?.owner || ''}
                    placeholder="Enter full name..."
                    onChange={(e) => setState(p => ({...p, balls: p.balls.map(b => b.number === selectedBall ? {...b, owner: e.target.value || null} : b)}))}
                  />
                ) : (
                  <div className="bg-slate-50 p-8 rounded-[2rem] border border-slate-100">
                    <p className="text-5xl font-black text-slate-800 tracking-tight">{state.balls.find(b => b.number === selectedBall)?.owner || 'Available'}</p>
                  </div>
                )}
              </div>
              {state.balls.find(b => b.number === selectedBall)?.owner && (
                <div className="space-y-12">
                  <div className={`p-10 rounded-[3.5rem] border-4 shadow-inner transition-colors duration-500 ${isPaidForNextDraw(state.balls.find(b => b.number === selectedBall)!) ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3">Next Draw Coverage</p>
                    <p className={`text-3xl font-black ${isPaidForNextDraw(state.balls.find(b => b.number === selectedBall)!) ? 'text-emerald-600' : 'text-rose-600'}`}>
                      Until {formatDate(state.balls.find(b => b.number === selectedBall)!.paidUntil)}
                    </p>
                  </div>
                  <button 
                    onClick={() => setFollowedBall(followedBall === selectedBall ? null : selectedBall)}
                    className={`w-full py-8 rounded-[2rem] font-black text-[12px] uppercase tracking-widest transition-all shadow-xl ${followedBall === selectedBall ? 'bg-indigo-600 text-white shadow-indigo-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    {followedBall === selectedBall ? '★ Unfollow Number' : '☆ Pin to Dashboard'}
                  </button>
                  {isAdmin && (
                    <div className="space-y-8 pt-8 border-t border-slate-100">
                      <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest pl-2">Management</label>
                      <div className="grid grid-cols-2 gap-4">
                        <button onClick={() => addPayment(selectedBall, 1)} className="p-8 rounded-[1.5rem] bg-indigo-50 text-indigo-700 font-black text-[11px] uppercase hover:bg-indigo-600 hover:text-white transition-all shadow-sm">+1 Week</button>
                        <button onClick={() => addPayment(selectedBall, 4)} className="p-8 rounded-[1.5rem] bg-indigo-50 text-indigo-700 font-black text-[11px] uppercase hover:bg-indigo-600 hover:text-white transition-all shadow-sm">+4 Weeks</button>
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
        <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-3xl z-[100] flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-white rounded-[4rem] w-full max-w-md p-14 shadow-2xl animate-in zoom-in-95 duration-300">
            <h3 className="text-4xl font-black text-slate-800 mb-2 text-center tracking-tight">Access Gate</h3>
            <p className="text-center text-slate-400 font-black text-[10px] uppercase tracking-[0.3em] mb-12">Authorized Only</p>
            <input 
              autoFocus
              type="password"
              className="w-full bg-slate-50 border-4 border-slate-100 rounded-[2rem] p-10 text-center text-6xl font-black outline-none focus:border-indigo-600 mb-12 transition-all text-slate-900 shadow-inner tracking-widest"
              placeholder="••••"
              value={loginPass}
              onChange={(e) => setLoginPass(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            />
            <div className="flex gap-4">
              <button onClick={() => setShowLogin(false)} className="flex-1 py-8 font-black text-[12px] uppercase tracking-widest text-slate-300">Exit</button>
              <button onClick={handleLogin} className="flex-1 py-8 bg-indigo-600 text-white rounded-[1.5rem] font-black text-[12px] uppercase tracking-widest shadow-2xl shadow-indigo-100">Unlock</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const TabButton: React.FC<{ active: boolean, onClick: () => void, label: string }> = ({ active, onClick, label }) => (
  <button 
    onClick={onClick}
    className={`px-8 py-3.5 rounded-2xl text-[11px] font-black transition-all ${active ? 'bg-white text-indigo-600 shadow-xl ring-1 ring-black/5' : 'text-slate-400 hover:text-slate-600'}`}
  >
    {label}
  </button>
);

const MobileNavLink: React.FC<{ icon: React.ReactNode, label: string, active: boolean, onClick: () => void }> = ({ icon, label, active, onClick }) => (
  <button 
    onClick={onClick}
    className={`flex-1 flex flex-col items-center justify-center gap-2 transition-all ${active ? 'text-indigo-600' : 'text-slate-300'}`}
  >
    <div className={`p-3 rounded-2xl transition-all ${active ? 'bg-indigo-50 scale-125 shadow-sm' : ''}`}>{icon}</div>
    <span className={`text-[10px] font-black uppercase tracking-widest ${active ? 'opacity-100' : 'opacity-50'}`}>{label}</span>
  </button>
);

const RuleItem: React.FC<{ icon: string, title: string, desc: string }> = ({ icon, title, desc }) => (
  <div className="flex gap-6 bg-white/5 p-8 rounded-[2rem] border border-white/5 group hover:bg-white/10 transition-colors">
    <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-xl font-black shadow-lg">{icon}</div>
    <div>
      <p className="font-black text-lg uppercase tracking-tight text-slate-100 mb-1">{title}</p>
      <p className="text-xs text-slate-400 leading-relaxed font-medium">{desc}</p>
    </div>
  </div>
);

export default App;
