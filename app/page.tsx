"use client";

import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../utils/supabase'; // Ensure this path matches your project structure
import { useRouter } from 'next/navigation';

interface HealthData {
  id?: string;
  temperature: number;
  bpm: number;
  spo2: number;
  ai_response: string;
  identified_name: string;
  created_at: string;
}

export default function AstraDashboard() {
  const [latestData, setLatestData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [accountName, setAccountName] = useState("Doctor"); 
  
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const router = useRouter();

  // ==========================================
  // FETCH LATEST DATA MANUALLY
  // ==========================================
  const fetchLatestData = async () => {
    setIsRefreshing(true);
    const { data, error } = await supabase
      .from('health_data')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (data) {
      setLatestData(data);
    }
    setIsRefreshing(false);
    setLoading(false);
  };

  // ==========================================
  // TEXT-TO-SPEECH (A.S.T.R.A'S VOICE)
  // ==========================================
  const playDiagnosisAudio = (text: string) => {
    if ('speechSynthesis' in window) {
      // Cancel any ongoing speech
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0; 
      utterance.pitch = 1.1; 
      
      utterance.onstart = () => setIsPlayingAudio(true);
      utterance.onend = () => setIsPlayingAudio(false);
      utterance.onerror = () => setIsPlayingAudio(false);

      window.speechSynthesis.speak(utterance);
    }
  };

  // ==========================================
  // INITIALIZATION & REALTIME LISTENER
  // ==========================================
  useEffect(() => {
    let isMounted = true;

    const initDashboard = async () => {
      // Optional: Check Auth Session (remove if you don't use Supabase Auth)
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      
      if (currentSession && isMounted) {
        setSession(currentSession);
        const displayName = currentSession.user?.user_metadata?.display_name;
        if (displayName) setAccountName(displayName);
      }

      await fetchLatestData();
    };

    initDashboard();

    // 🔥 THE MAGIC: SUPABASE REALTIME LISTENER
    // This listens for new rows inserted by your ESP32/Vercel API
    const channel = supabase
      .channel('live-health-data')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'health_data' },
        (payload) => {
          console.log('📡 NEW SCAN RECEIVED FROM ESP32!', payload.new);
          const newData = payload.new as HealthData;
          
          // 1. Instantly update the screen
          setLatestData(newData);
          
          // 2. Instantly speak the AI's diagnosis
          if (newData.ai_response) {
            playDiagnosisAudio(newData.ai_response);
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // ==========================================
  // RENDER UI
  // ==========================================
  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-cyan-500 font-mono tracking-widest animate-pulse">
          INITIALIZING A.S.T.R.A LINK...
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white p-8 font-sans selection:bg-cyan-900">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* HEADER */}
        <header className="flex justify-between items-end border-b border-slate-800 pb-6">
          <div>
            <h1 className="text-4xl font-black tracking-tighter bg-gradient-to-r from-cyan-400 to-blue-600 bg-clip-text text-transparent">
              A.S.T.R.A
            </h1>
            <p className="text-slate-500 text-sm font-bold tracking-widest mt-1 uppercase">
              Medical Telemetry Dashboard
            </p>
          </div>
          <div className="text-right">
            <p className="text-slate-400 text-xs tracking-widest uppercase mb-1">Active Session</p>
            <p className="font-mono text-cyan-400">{accountName}</p>
          </div>
        </header>

        {/* MAIN CONTENT */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* VITALS COLUMN (Left) */}
          <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <StatCard 
                icon="🌡️" 
                title="Temperature" 
                value={latestData?.temperature || "--"} 
                unit="°C" 
                color="bg-slate-900" 
                textColor="text-yellow-400" 
              />
              <StatCard 
                icon="❤️" 
                title="Heart Rate" 
                value={latestData?.bpm || "--"} 
                unit="BPM" 
                color="bg-slate-900" 
                textColor="text-red-400"
                pulse={true} 
              />
              <StatCard 
                icon="💨" 
                title="Blood Oxygen" 
                value={latestData?.spo2 || "--"} 
                unit="%" 
                color="bg-slate-900" 
                textColor="text-cyan-400" 
              />
            </div>

            {/* AI DIAGNOSIS PANEL */}
            <div className="bg-slate-900 rounded-[2rem] p-8 border border-slate-800 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-2 h-full bg-gradient-to-b from-cyan-500 to-blue-600"></div>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-sm font-black text-slate-400 uppercase tracking-[0.2em]">
                  Gemini AI Analysis
                </h2>
                {isPlayingAudio && (
                  <span className="flex items-center text-xs font-bold text-cyan-400 uppercase tracking-widest animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 mr-2"></span>
                    Speaking...
                  </span>
                )}
              </div>
              
              <p className="text-2xl leading-relaxed text-slate-200 font-light">
                {latestData?.ai_response || "Waiting for patient telemetry..."}
              </p>
              
              <div className="mt-8 pt-6 border-t border-slate-800 flex justify-between items-center">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-widest">Identified Patient</p>
                  <p className="text-lg font-bold text-cyan-400">{latestData?.identified_name || "Unknown"}</p>
                </div>
                <button 
                  onClick={() => playDiagnosisAudio(latestData?.ai_response || "")}
                  className="px-6 py-2 rounded-full bg-slate-800 hover:bg-slate-700 text-xs font-bold uppercase tracking-widest transition-colors"
                >
                  ▶ Replay Audio
                </button>
              </div>
            </div>
          </div>

          {/* SYSTEM STATUS COLUMN (Right) */}
          <div className="space-y-6">
            <div className="bg-slate-900 rounded-[2rem] p-8 border border-slate-800">
              <h2 className="text-sm font-black text-slate-400 uppercase tracking-[0.2em] mb-6">System Status</h2>
              
              <div className="space-y-4">
                 <button 
                   onClick={fetchLatestData}
                   disabled={isRefreshing}
                   className="w-full py-4 rounded-xl bg-cyan-900/30 hover:bg-cyan-900/50 text-cyan-400 border border-cyan-800/50 text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50"
                 >
                   {isRefreshing ? "Syncing..." : "Manual Sync"}
                 </button>

                 <div className="mt-6 pt-6 border-t border-slate-800">
                    <div className="flex justify-between items-center text-[10px] font-bold">
                       <span className="text-slate-500 uppercase tracking-widest">ESP32 Status</span>
                       <span className="text-green-500 uppercase tracking-widest flex items-center">
                         <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-2 animate-pulse"></span>
                         Live Listening
                       </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] font-bold mt-3">
                       <span className="text-slate-500 uppercase tracking-widest">Last Update</span>
                       <span className="text-slate-300">
                         {latestData?.created_at ? new Date(latestData.created_at).toLocaleTimeString() : "--:--"}
                       </span>
                    </div>
                 </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

// ==========================================
// REUSABLE CARD COMPONENT
// ==========================================
function StatCard({ icon, title, value, unit, color, textColor, pulse = false }: any) {
  return (
    <div className={`${color} rounded-[2rem] p-8 border border-slate-800 transition-all hover:border-slate-700`}>
      <div className="flex items-center justify-between mb-6">
        <span className="text-4xl filter drop-shadow-sm">{icon}</span>
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{title}</span>
      </div>
      <div className="flex items-baseline">
        <span className={`text-5xl font-black ${textColor} tracking-tighter ${pulse ? 'animate-pulse' : ''}`}>
          {value}
        </span>
        <span className={`${textColor} text-sm font-black ml-2 uppercase tracking-widest`}>{unit}</span>
      </div>
    </div>
  );
}