"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '../../../utils/supabase'; // Adjusted path to match your hierarchy

export default function AdminMappingPortal() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [pendingVitals, setPendingVitals] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  // ==========================================
  // 📡 REALTIME LISTENER: Capture ESP32 Dumps
  // ==========================================
  useEffect(() => {
    const fetchLatestDump = async () => {
      // Fetch the latest reading that hasn't been assigned to a user yet
      const { data } = await supabase
        .from('health_data')
        .select('*')
        .is('user_id', null) 
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (data) setPendingVitals(data);
    };

    fetchLatestDump();
    
    // Subscribe to new incoming dumps
    const channel = supabase.channel('admin-pending-dumps')
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'health_data' }, 
        (payload) => {
          if (!payload.new.user_id) setPendingVitals(payload.new);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // ==========================================
  // 🔗 MAPPING LOGIC: Verify & Link
  // ==========================================
  const handleVerifyAndMap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingVitals) {
      setStatus("Error: No pending hardware data found to map.");
      return;
    }
    
    setLoading(true);
    setStatus("Verifying user credentials...");

    try {
      // 1. Find user matching BOTH Username and Email
      const { data: user, error } = await supabase
        .from('users')
        .select('id, name')
        .eq('name', username.trim())
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();

      if (error || !user) {
        setStatus("Verification Failed: No user found matching that Username and Email combination.");
        setLoading(false);
        return;
      }

      // 2. Map the pending vitals to the verified user
      const { error: updateError } = await supabase
        .from('health_data')
        .update({ 
          user_id: user.id, 
          identified_name: user.name,
          ai_response: `Manual mapping confirmed by Admin for ${user.name}.`
        })
        .eq('id', pendingVitals.id);

      if (updateError) throw updateError;

      setStatus(`Success! Data mapped to ${user.name}. Dashboard updated.`);
      setPendingVitals(null); // Clear the slot for the next dump
      setUsername("");
      setEmail("");
    } catch (err: any) {
      setStatus(`System Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-8">
        
        <header className="border-b border-slate-800 pb-6">
          <h1 className="text-3xl font-black text-cyan-400 tracking-tighter uppercase">A.S.T.R.A Admin Mapping</h1>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Direct Hardware-to-Patient Synchronization</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* LEFT: PENDING DATA DISPLAY */}
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-xl flex flex-col justify-center">
            <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-6 flex items-center">
              <span className="w-2 h-2 rounded-full bg-cyan-500 mr-2 animate-pulse"></span>
              Live ESP32 Dump
            </h2>
            
            {pendingVitals ? (
              <div className="space-y-6 animate-in fade-in zoom-in duration-300">
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-black p-4 rounded-2xl border border-slate-800 text-center">
                    <p className="text-[10px] text-slate-500 uppercase mb-1">Temp</p>
                    <p className="text-xl font-black text-yellow-400">{pendingVitals.temperature}°C</p>
                  </div>
                  <div className="bg-black p-4 rounded-2xl border border-slate-800 text-center">
                    <p className="text-[10px] text-slate-500 uppercase mb-1">Pulse</p>
                    <p className="text-xl font-black text-red-500">{pendingVitals.bpm}</p>
                  </div>
                  <div className="bg-black p-4 rounded-2xl border border-slate-800 text-center">
                    <p className="text-[10px] text-slate-500 uppercase mb-1">SpO2</p>
                    <p className="text-xl font-black text-cyan-400">{pendingVitals.spo2}%</p>
                  </div>
                </div>
                <p className="text-[10px] text-center text-slate-600 uppercase font-bold tracking-widest">
                  Received at {new Date(pendingVitals.created_at).toLocaleTimeString()}
                </p>
              </div>
            ) : (
              <div className="py-12 border-2 border-dashed border-slate-800 rounded-3xl flex flex-col items-center justify-center text-slate-600">
                <p className="text-xs font-bold uppercase tracking-widest">Waiting for ESP32 Signal...</p>
                <p className="text-[9px] mt-2">Trigger Ultrasonic Sensor to begin</p>
              </div>
            )}
          </div>

          {/* RIGHT: VERIFICATION FORM */}
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-xl">
            <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-6">Patient Verification</h2>
            
            <form onSubmit={handleVerifyAndMap} className="space-y-4">
              <div>
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">Username</label>
                <input 
                  type="text"
                  placeholder="e.g. Soham"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-black border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 transition-all"
                  required
                />
              </div>
              <div>
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">Email Address</label>
                <input 
                  type="email"
                  placeholder="soham@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-black border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 transition-all"
                  required
                />
              </div>

              <button 
                type="submit"
                disabled={loading || !pendingVitals}
                className="w-full py-4 bg-cyan-600 hover:bg-cyan-500 text-white font-black uppercase tracking-widest rounded-xl text-xs transition-all disabled:opacity-30 disabled:cursor-not-allowed mt-2"
              >
                {loading ? "Verifying..." : "Verify & Map to Dashboard"}
              </button>
            </form>

            {status && (
              <div className={`mt-6 p-4 rounded-xl text-[10px] font-bold uppercase tracking-widest border text-center ${
                status.includes("Success") ? "bg-cyan-900/20 border-cyan-800 text-cyan-400" : "bg-red-900/20 border-red-800 text-red-400"
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