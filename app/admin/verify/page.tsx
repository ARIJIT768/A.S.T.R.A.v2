"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '../../../utils/supabase'; // Adjust path based on your folder structure
import { useRouter } from 'next/navigation';

export default function MasterAdminMappingPortal() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [pendingVitals, setPendingVitals] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  
  const router = useRouter();

  // ==========================================
  // 📡 INITIALIZATION & REALTIME LISTENER
  // ==========================================
  useEffect(() => {
    let isMounted = true;

    const initAdmin = async () => {
      // 1. Mandatory Session Security Check
      const { data: { session } } = await supabase.auth.getSession();
      if (!session && isMounted) {
        router.replace('/auth');
        return;
      }
      if (isMounted) setPageLoading(false);

      // 2. Fetch the latest unmapped hardware dump
      const { data } = await supabase
        .from('health_data')
        .select('*')
        .is('user_id', null) 
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (data && isMounted) setPendingVitals(data);
    };

    initAdmin();
    
    // 3. Subscribe to new incoming ESP32 dumps in real-time
    const channel = supabase.channel('admin-pending-dumps')
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'health_data' }, 
        (payload) => {
          if (!payload.new.user_id) {
            setPendingVitals(payload.new);
            setStatus(""); // Clear previous status on new scan
          }
        }
      )
      .subscribe();

    return () => { 
      isMounted = false;
      supabase.removeChannel(channel); 
    };
  }, [router]);

  // ==========================================
  // 🔗 MAPPING LOGIC: Verify & Link
  // ==========================================
  const handleVerifyAndMap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingVitals) {
      setStatus("Error: No pending hardware data to map.");
      return;
    }
    
    setLoading(true);
    setStatus("Verifying patient credentials...");

    try {
      // 1. Find user matching BOTH Username and Email exactly
      const { data: user, error } = await supabase
        .from('users')
        .select('id, name')
        .eq('name', username.trim())
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();

      if (error || !user) {
        setStatus("Verification Failed: No patient found matching that Name and Email.");
        setLoading(false);
        return;
      }

      // 2. Map the pending vitals to the verified patient
      const { error: updateError } = await supabase
        .from('health_data')
        .update({ 
          user_id: user.id, 
          identified_name: user.name,
          ai_response: `Secure telemetry mapping confirmed by A.S.T.R.A Admin for ${user.name}.`
        })
        .eq('id', pendingVitals.id);

      if (updateError) throw updateError;

      setStatus(`Success! Telemetry mapped to ${user.name}. Patient Dashboard updated.`);
      setPendingVitals(null); 
      setUsername("");
      setEmail("");
    } catch (err: any) {
      setStatus(`System Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // 🗑️ DISCARD LOGIC: Reject False Scans
  // ==========================================
  const handleDiscardScan = async () => {
    if (!pendingVitals) return;
    setLoading(true);
    try {
      await supabase.from('health_data').delete().eq('id', pendingVitals.id);
      setPendingVitals(null);
      setStatus("False scan discarded. Awaiting new telemetry.");
    } catch (err) {
      setStatus("Error discarding scan.");
    } finally {
      setLoading(false);
    }
  };

  if (pageLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center font-mono text-cyan-500 animate-pulse uppercase tracking-widest text-xs">
        Securing Admin Portal...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8 font-sans selection:bg-cyan-900">
      <div className="max-w-6xl mx-auto space-y-8">
        
        <header className="border-b border-slate-800 pb-6 flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-black text-cyan-400 tracking-tighter uppercase">A.S.T.R.A Admin Link</h1>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-[0.3em] mt-1">Direct Hardware-to-Patient Synchronization</p>
          </div>
          <button 
            onClick={() => router.replace('/dashboard')}
            className="text-[10px] text-slate-500 hover:text-cyan-400 font-bold uppercase tracking-widest transition-colors"
          >
            ← Return to Dashboard
          </button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* LEFT: PENDING DATA DISPLAY */}
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2rem] shadow-2xl flex flex-col justify-center h-[450px]">
            <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center">
              <span className={`w-2 h-2 rounded-full mr-3 ${pendingVitals ? 'bg-cyan-500 animate-pulse' : 'bg-slate-700'}`}></span>
              Live Hardware Dump
            </h2>
            
            {pendingVitals ? (
              <div className="space-y-8 animate-in fade-in zoom-in duration-300">
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-black/50 p-6 rounded-2xl border border-slate-800 text-center shadow-inner">
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2">Temp</p>
                    <p className="text-3xl font-black text-yellow-400">{pendingVitals.temperature}°C</p>
                  </div>
                  <div className="bg-black/50 p-6 rounded-2xl border border-slate-800 text-center shadow-inner">
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2">Pulse</p>
                    <p className="text-3xl font-black text-red-500 animate-pulse">{pendingVitals.bpm}</p>
                  </div>
                  <div className="bg-black/50 p-6 rounded-2xl border border-slate-800 text-center shadow-inner">
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2">SpO2</p>
                    <p className="text-3xl font-black text-cyan-400">{pendingVitals.spo2}%</p>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-[9px] text-slate-600 uppercase font-black tracking-[0.3em]">
                    Signal Received at {new Date(pendingVitals.created_at).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ) : (
              <div className="h-full border-2 border-dashed border-slate-800 rounded-2xl flex flex-col items-center justify-center text-slate-600 space-y-3">
                <svg className="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <p className="text-xs font-black uppercase tracking-widest">Awaiting ESP32 Signal</p>
                <p className="text-[9px] font-bold uppercase tracking-widest opacity-60">Trigger Ultrasonic Sensor to begin</p>
              </div>
            )}
          </div>

          {/* RIGHT: VERIFICATION FORM */}
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2rem] shadow-2xl flex flex-col h-[450px]">
            <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6">Patient Verification</h2>
            
            <form onSubmit={handleVerifyAndMap} className="space-y-5 flex-1 flex flex-col">
              <div>
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 ml-1">Patient Full Name</label>
                <input 
                  type="text"
                  placeholder="e.g. Soham"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-black border border-slate-800 rounded-xl px-5 py-4 text-sm focus:outline-none focus:border-cyan-500 transition-all font-bold text-white placeholder:text-slate-700"
                  required
                />
              </div>
              <div>
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 ml-1">Medical Email Address</label>
                <input 
                  type="email"
                  placeholder="soham@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-black border border-slate-800 rounded-xl px-5 py-4 text-sm focus:outline-none focus:border-cyan-500 transition-all font-bold text-white placeholder:text-slate-700"
                  required
                />
              </div>

              <div className="mt-auto pt-4 space-y-3">
                <button 
                  type="submit"
                  disabled={loading || !pendingVitals}
                  className="w-full py-4 bg-cyan-600 hover:bg-cyan-500 text-white font-black uppercase tracking-widest rounded-xl text-xs transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(6,182,212,0.2)]"
                >
                  {loading ? "Processing..." : "Verify Identity & Map Telemetry"}
                </button>
                
                {/* DISCARD BUTTON */}
                {pendingVitals && (
                  <button 
                    type="button"
                    onClick={handleDiscardScan}
                    disabled={loading}
                    className="w-full py-3 bg-red-950/30 hover:bg-red-900/40 border border-red-900/50 text-red-500 font-black uppercase tracking-widest rounded-xl text-[10px] transition-all"
                  >
                    Discard False Scan
                  </button>
                )}
              </div>
            </form>

            {status && (
              <div className={`mt-6 p-4 rounded-xl text-[10px] font-bold uppercase tracking-widest border text-center animate-in fade-in slide-in-from-bottom-2 ${
                status.includes("Success") ? "bg-cyan-950/50 border-cyan-800 text-cyan-400" : 
                status.includes("Discarded") ? "bg-slate-800 border-slate-700 text-slate-300" : 
                "bg-red-950/50 border-red-800 text-red-400"
              }`}>
                {status}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}