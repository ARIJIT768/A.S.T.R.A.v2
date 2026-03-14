"use client";

import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../../utils/supabase'; 
import { useRouter } from 'next/navigation';

interface HealthData {
  id: string;
  temperature: number;
  bpm: number;
  spo2: number;
  ai_response: string;
  identified_name: string;
  created_at: string;
}

export default function AstraDashboard() {
  const [history, setHistory] = useState<HealthData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [accountName, setAccountName] = useState("Patient"); 
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const latestData = history[0] || null;
  const router = useRouter();

  // ==========================================
  // FETCH RECENT HISTORY
  // ==========================================
  const fetchHistory = async () => {
    setIsRefreshing(true);
    const { data } = await supabase
      .from('health_data')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(15);

    if (data) setHistory(data);
    setIsRefreshing(false);
    setLoading(false);
  };

  // ==========================================
  // TEXT-TO-SPEECH
  // ==========================================
  const playDiagnosisAudio = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0; 
      utterance.pitch = 1.1; 
      utterance.onstart = () => setIsPlayingAudio(true);
      utterance.onend = () => setIsPlayingAudio(false);
      window.speechSynthesis.speak(utterance);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      // 1. Check for Active Session
      const { data: { session } } = await supabase.auth.getSession();

      // 2. Mandatory Redirect if Not Authenticated
      if (!session && isMounted) {
        router.replace('/auth'); // Redirect to your authentication page
        return;
      }

      // 3. Populate Dashboard for Authenticated Users
      if (session && isMounted) {
        setAccountName(session.user?.user_metadata?.display_name || "Patient");
        await fetchHistory();
      }
    };

    init();

    // 📡 REALTIME LISTENER: Updates UI when ESP32 dumps new data
    const channel = supabase
      .channel('live-health-data')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'health_data' }, (payload) => {
          const newData = payload.new as HealthData;
          setHistory(prev => [newData, ...prev.slice(0, 14)]);
          if (newData.ai_response) playDiagnosisAudio(newData.ai_response);
      }).subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [router]);

  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center font-mono text-cyan-500 animate-pulse">
      SYNCING A.S.T.R.A TELEMETRY...
    </div>
  );

  return (
    <main className="min-h-screen bg-black text-white p-6 font-sans selection:bg-cyan-900">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* HEADER */}
        <header className="flex justify-between items-center border-b border-slate-800 pb-6">
          <div>
            <h1 className="text-3xl font-black tracking-tighter bg-gradient-to-r from-cyan-400 to-blue-600 bg-clip-text text-transparent uppercase">
              A.S.T.R.A Dashboard
            </h1>
            <p className="text-slate-500 text-[10px] font-bold tracking-[0.3em] uppercase mt-1">Medical Expert System v2.0</p>
          </div>
          <div className="flex gap-4 items-center">
            <div className="text-right mr-4">
              <p className="text-slate-500 text-[9px] uppercase font-bold tracking-widest">Operator</p>
              <p className="font-mono text-cyan-400 text-sm tracking-tighter">{accountName}</p>
            </div>
            <button 
              onClick={fetchHistory} 
              className={`p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-cyan-500 transition-all ${isRefreshing ? 'animate-spin' : ''}`}
            >
              🔄
            </button>
            <button 
              onClick={async () => {
                await supabase.auth.signOut();
                router.replace('/auth');
              }}
              className="p-2 rounded-lg bg-red-900/20 border border-red-900/50 hover:bg-red-900/40 text-red-400 text-[10px] font-black uppercase tracking-widest transition-all"
            >
              Sign Out
            </button>
          </div>
        </header>

        {/* TOP ROW: PRIMARY VITALS GRID */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard icon="🌡️" title="Temperature" value={latestData?.temperature || "--"} unit="°C" color="text-yellow-400" />
          <StatCard icon="❤️" title="Heart Rate" value={latestData?.bpm || "--"} unit="BPM" color="text-red-500" pulse={true} />
          <StatCard icon="💨" title="Blood Oxygen" value={latestData?.spo2 || "--"} unit="%" color="text-cyan-400" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-[500px]">
          {/* LEFT: CONVERSATIONAL DIAGNOSTIC INTERFACE */}
          <div className="lg:col-span-2 flex flex-col bg-slate-900/50 rounded-3xl border border-slate-800 overflow-hidden">
            <div className="p-4 bg-slate-950/50 border-b border-slate-800 flex justify-between items-center">
               <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">
                 <span className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse"></span>
                 Diagnostic Chat
               </h3>
               {isPlayingAudio && <span className="text-[9px] font-bold text-cyan-500 animate-pulse">AI SPEAKING...</span>}
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
               {history.length > 0 ? (
                 history.slice(0, 5).reverse().map((msg) => (
                    <div key={msg.id} className="flex items-start gap-4 animate-in fade-in slide-in-from-left-4">
                       <div className="w-8 h-8 rounded-lg bg-cyan-600 flex items-center justify-center text-[10px] font-black">AI</div>
                       <div className="flex-1">
                          <div className="bg-slate-800/80 p-4 rounded-2xl rounded-tl-none text-sm font-light leading-relaxed text-slate-200 border border-slate-700/50">
                            {msg.ai_response}
                          </div>
                          <p className="text-[9px] text-slate-500 mt-2 uppercase font-bold tracking-tighter">
                            {new Date(msg.created_at).toLocaleTimeString()} • Verified Scan for {msg.identified_name}
                          </p>
                       </div>
                    </div>
                 ))
               ) : (
                 <div className="h-full flex items-center justify-center text-slate-600 text-xs font-bold uppercase tracking-widest">
                   Awaiting System Trigger...
                 </div>
               )}
               <div ref={messagesEndRef} />
            </div>
          </div>

          {/* RIGHT: COMPACT HISTORY LOG */}
          <div className="bg-slate-900/50 rounded-3xl p-6 border border-slate-800 flex flex-col">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6 border-b border-slate-800 pb-4">
              Telemetry History
            </h3>
            <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-hide">
              {history.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-slate-800/50 hover:bg-slate-800 transition-all group">
                  <div>
                    <p className="text-[9px] font-mono text-slate-500 group-hover:text-cyan-500 transition-colors">
                      {new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-[11px] font-bold text-slate-300">{entry.bpm} BPM | {entry.spo2}%</p>
                  </div>
                  <div className="text-right">
                    <span className={`text-xs font-black ${entry.temperature > 37.5 ? 'text-red-400' : 'text-green-400'}`}>
                      {entry.temperature}°C
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function StatCard({ icon, title, value, unit, color, pulse = false }: any) {
  return (
    <div className="bg-slate-900/40 rounded-[2.5rem] p-8 border border-slate-800 transition-all hover:border-slate-700 hover:bg-slate-900/60 group">
      <div className="flex justify-between items-center mb-6">
        <span className="text-4xl group-hover:scale-110 transition-transform duration-300">{icon}</span>
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">{title}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-5xl font-black tracking-tighter ${color} ${pulse ? 'animate-pulse' : ''}`}>
          {value}
        </span>
        <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">{unit}</span>
      </div>
    </div>
  );
}