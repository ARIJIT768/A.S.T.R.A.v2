"use client";

import React, { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase'; // Adjust path if needed
import { useRouter } from 'next/navigation';

interface HealthData {
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
  const [session, setSession] = useState<any>(null);
  
  const [accountName, setAccountName] = useState("Patient"); 
  const router = useRouter();

  useEffect(() => {
    let isMounted = true;

    const initDashboard = async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      
      if (!currentSession) {
        if (isMounted) {
          setLoading(false);
          router.replace('/auth'); 
        }
        return;
      }

      if (isMounted) {
        setSession(currentSession);
        
        const displayName = currentSession.user?.user_metadata?.display_name;
        if (displayName) {
          setAccountName(displayName);
        }

        await fetchLatestVitals();
        setLoading(false);
      }
    };

    initDashboard();

    const subscription = supabase
      .channel('vitals-update')
      .on(
        'postgres_changes' as any, 
        { event: 'INSERT', table: 'health_data', schema: 'public' }, 
        (payload: any) => {
          if (payload.new && isMounted) {
            setLatestData(payload.new as HealthData);
          }
        }
      )
      .subscribe();

    return () => { 
      isMounted = false;
      supabase.removeChannel(subscription); 
    };
  }, [router]);

  async function fetchLatestVitals() {
    try {
      const { data, error } = await supabase
        .from('health_data')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!error && data) {
        setLatestData(data as HealthData);
      }
    } catch (err) {
      console.error("Error fetching vitals:", err);
    }
  }

  // LOGOUT FUNCTION
  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/auth');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mb-4 mx-auto"></div>
          <p className="text-cyan-500 font-black tracking-widest text-[10px] uppercase animate-pulse">
            Establishing Secure Link...
          </p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-8 selection:bg-green-100">
      <div className="max-w-7xl mx-auto">

        {/* --- HEADER SECTION --- */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight">
              Welcome, <span className="text-green-600">{accountName}</span>
            </h1>
            <p className="text-slate-500 font-bold uppercase text-[10px] tracking-[0.2em] mt-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse mr-2"></span>
              A.S.T.R.A Bio-Telemetry Online
            </p>
          </div>

          {/* TOP RIGHT CONTROLS: Logo & New Red Logout Button */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-4 bg-white p-4 rounded-3xl shadow-sm border border-slate-200 hidden md:flex">
              <div className="w-12 h-12 bg-green-600 rounded-2xl flex items-center justify-center shadow-lg shadow-green-600/20">
                <i className="fas fa-microchip text-white text-xl"></i>
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900 leading-tight tracking-tighter">A.S.T.R.A</h2>
                <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">v2.0 Flash Core</p>
              </div>
            </div>

            {/* NEW RED LOGOUT BUTTON */}
            <button 
              onClick={handleLogout}
              className="flex items-center gap-3 bg-red-600 hover:bg-red-500 text-white p-4 md:px-6 md:py-4 rounded-3xl shadow-lg shadow-red-600/30 transition-all active:scale-95 border border-red-500/50"
              title="Terminate Session"
            >
              <i className="fas fa-power-off text-lg"></i>
              <span className="font-black text-[10px] uppercase tracking-[0.2em] hidden sm:block">
                Terminate
              </span>
            </button>
          </div>
        </div>

        {/* Live Vitals Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <StatCard icon="❤️" title="Heart Rate" value={latestData ? String(latestData.bpm) : "--"} unit="bpm" status="Pulse Sensor" color="bg-red-50" textColor="text-red-600" pulse={true} />
          <StatCard icon="🌡️" title="Body Temp" value={latestData ? latestData.temperature.toFixed(1) : "--"} unit="°C" status="IR Thermal" color="bg-orange-50" textColor="text-orange-600" />
          <StatCard icon="💧" title="Blood Oxygen" value={latestData ? String(latestData.spo2) : "--"} unit="%" status="SpO2 Saturation" color="bg-blue-50" textColor="text-blue-600" />
        </div>

        {/* Main Interface Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="lg:col-span-2">
            <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200 p-8 md:p-10 relative overflow-hidden h-full">
               <div className="absolute top-0 right-0 p-6">
                  <span className="flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
               </div>
               <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-6">Medical AI Insights (Gemini 2.0)</h2>
               <div className="min-h-[150px] flex flex-col justify-center">
                 {latestData ? (
                   <p className="text-2xl font-bold text-slate-800 leading-relaxed italic">"{latestData.ai_response}"</p>
                 ) : (
                   <p className="text-xl font-bold text-slate-300 italic animate-pulse">Place your finger on the A.S.T.R.A sensor to begin scan...</p>
                 )}
               </div>
               <div className="mt-8 pt-8 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
                 <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                      <i className="fas fa-user text-slate-400 text-xs"></i>
                    </div>
                    <span className="text-[11px] font-black text-slate-900 uppercase tracking-widest">
                      Subject: {latestData?.identified_name || "Awaiting Identification"}
                    </span>
                 </div>
                 <span className="text-[10px] font-bold text-slate-400">
                   {latestData ? `Last Updated: ${new Date(latestData.created_at).toLocaleTimeString()}` : "System Ready"}
                 </span>
               </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-[#0f172a] rounded-[2.5rem] p-8 text-white shadow-2xl">
              <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-8 text-center">System Control</h2>
              <div className="space-y-4">
                 <button className="w-full py-4 bg-green-600 hover:bg-green-500 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] transition-all shadow-lg shadow-green-900/20 active:scale-95">
                   Force Hardware Scan
                 </button>
                 {/* I removed the redundant bottom logout button here to keep it clean! */}
                 <div className="mt-6 pt-6 border-t border-slate-800">
                    <div className="flex justify-between items-center text-[10px] font-bold">
                       <span className="text-slate-500 uppercase tracking-widest">ESP32 Status</span>
                       <span className="text-green-500 uppercase tracking-widest">Live</span>
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

function StatCard({ icon, title, value, unit, status, color, textColor, pulse = false }: any) {
  return (
    <div className={`${color} rounded-[2rem] p-8 border border-slate-100 transition-all hover:shadow-md hover:-translate-y-1`}>
      <div className="flex items-center justify-between mb-6">
        <span className="text-4xl filter drop-shadow-sm">{icon}</span>
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{title}</span>
      </div>
      <div className="flex items-baseline">
        <span className={`text-5xl font-black ${textColor} tracking-tighter ${pulse ? 'animate-pulse' : ''}`}>{value}</span>
        <span className={`${textColor} text-sm font-black ml-2 uppercase tracking-widest`}>{unit}</span>
      </div>
    </div>
  );
}