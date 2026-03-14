"use client";

import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../utils/supabase'; // Ensure this matches your file hierarchy
import { useRouter } from 'next/navigation';

interface HealthData {
  id: string;
  user_id: string;
  temperature: number;
  bpm: number;
  spo2: number;
  ai_response: string;
  identified_name: string;
  created_at: string;
}

// ==========================================
// MASSIVE KEYWORD & VITALS LOGIC ENGINE
// ==========================================
function generateAdvancedDiagnosticReport(temp: number, bpm: number, spo2: number, name: string, patientText: string): string {
  const text = patientText.toLowerCase();

  // 1. KEYWORD SCANNERS
  const hasHeadache = text.includes("headache") || text.includes("head") || text.includes("migraine") || text.includes("dizzy");
  const hasChestPain = text.includes("chest") || text.includes("heart") || text.includes("breath") || text.includes("tightness");
  const hasFatigue = text.includes("tired") || text.includes("weak") || text.includes("fatigue") || text.includes("exhausted") || text.includes("sleepy");
  const hasStomach = text.includes("stomach") || text.includes("nausea") || text.includes("vomit") || text.includes("sick") || text.includes("belly");
  const hasCough = text.includes("cough") || text.includes("throat") || text.includes("cold") || text.includes("sneezing");
  const hasStress = text.includes("stress") || text.includes("anxious") || text.includes("panic") || text.includes("nervous");
  const hasPain = text.includes("pain") || text.includes("hurt") || text.includes("ache") || text.includes("sore");

  // 2. HARDWARE SCANNERS
  const isHighFever = temp >= 39.0;
  const isMildFever = temp > 37.5 && temp < 39.0;
  const isHypothermia = temp < 35.5;
  const isSevereTachycardia = bpm > 120;
  const isTachycardia = bpm > 100 && bpm <= 120;
  const isBradycardia = bpm < 60;
  const isHypoxia = spo2 < 95;

  // 3. BUILD THE GREETING
  let response = `Patient ${name} identified. I have processed your typed symptoms and cross-referenced them with your live telemetry scan. `;

  // 4. SYMPTOM ACKNOWLEDGMENT
  let detectedSymptoms = [];
  if (hasHeadache) detectedSymptoms.push("cranial discomfort or dizziness");
  if (hasChestPain) detectedSymptoms.push("chest or respiratory distress");
  if (hasFatigue) detectedSymptoms.push("systemic fatigue");
  if (hasStomach) detectedSymptoms.push("gastrointestinal irregularity");
  if (hasCough) detectedSymptoms.push("respiratory irritation");
  if (hasStress) detectedSymptoms.push("elevated psychological stress");
  if (hasPain && detectedSymptoms.length === 0) detectedSymptoms.push("localized physical pain");

  if (detectedSymptoms.length > 0) {
    response += `I note that you are experiencing ${detectedSymptoms.join(" and ")}. `;
  } else if (text.length > 3) {
    response += `I have analyzed your input and did not detect severe clinical symptom keywords. `;
  }

  // 5. THE MEDICAL CROSS-REFERENCE ENGINE
  if (hasChestPain && (isSevereTachycardia || isHypoxia)) {
    return response + `CRITICAL ALERT: Your reported chest discomfort combined with abnormal cardiovascular telemetry strongly indicates a medical emergency. Please sit down, remain calm, and seek emergency medical assistance immediately.`;
  }
  if (isHighFever) {
    return response + `ALERT: Your core temperature is dangerously elevated at ${temp}°C. This indicates a severe acute response. Please seek immediate medical evaluation and attempt to safely lower your body temperature.`;
  }
  if (isHypoxia) {
    return response + `ALERT: Your blood oxygen saturation has dropped to ${spo2}%. This state of hypoxia requires immediate clinical attention. Please practice deep breathing and consult a doctor.`;
  }

  // MODERATE CONDITIONS
  if (hasStress && (isTachycardia || isSevereTachycardia)) {
    response += `Your elevated heart rate of ${bpm} BPM aligns with your reported feelings of stress and anxiety. This is a normal physiological response. I recommend engaging in a 5-minute box-breathing exercise to regulate your nervous system.`;
  } else if (hasFatigue && isBradycardia) {
    response += `Your reported fatigue is consistent with your resting heart rate of ${bpm} BPM, which is lower than average. Ensure you are consuming adequate calories and staying hydrated.`;
  } else if (isMildFever && hasCough) {
    response += `The combination of a ${temp}°C mild fever and respiratory symptoms strongly suggests a viral or bacterial infection. Please isolate, increase fluid intake, and prioritize rest.`;
  } else if (isMildFever && hasStomach) {
    response += `Your mild fever combined with gastrointestinal symptoms points to a potential stomach virus or foodborne pathogen. Maintain clear fluid intake to prevent dehydration.`;
  } else if (hasHeadache && isTachycardia) {
    response += `Headaches paired with an accelerated heart rate can frequently be attributed to dehydration or caffeine withdrawal. Please drink a large glass of water and rest your eyes away from bright screens.`;
  } 
  
  // ASYMMETRICAL CONDITIONS
  else if (detectedSymptoms.length > 0 && !isMildFever && !isTachycardia && !isBradycardia && !isHypoxia) {
    response += `Interestingly, while you reported physical discomfort, your core hardware vitals (Temp: ${temp}°C, Pulse: ${bpm} BPM, SpO2: ${spo2}%) are perfectly stable. This suggests your symptoms may be stress-related or muscular rather than a systemic physiological failure. Take some time to relax today.`;
  } else if (detectedSymptoms.length === 0 && (isMildFever || isTachycardia)) {
    response += `You did not report specific symptoms, but your hardware vitals show clinical abnormalities. Your body may be fighting off an asymptomatic issue. Please monitor yourself closely over the next few hours.`;
  } 
  
  // PERFECT HEALTH
  else {
    response += `Your core temperature is a healthy ${temp}°C, your pulse is stable at ${bpm} BPM, and your oxygen is optimal at ${spo2}%. All diagnostic criteria indicate you are in peak physical condition. Keep up your excellent daily routine.`;
  }

  return response;
}

export default function MasterAstraDashboard() {
  const [history, setHistory] = useState<HealthData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [accountName, setAccountName] = useState("Patient"); 
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  
  // Symptom Input State
  const [symptomInput, setSymptomInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const latestData = history[0] || null;
  const router = useRouter();

  const fetchHistory = async (userId: string) => {
    setIsRefreshing(true);
    const { data } = await supabase
      .from('health_data')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(15);

    if (data) setHistory(data);
    setIsRefreshing(false);
    setLoading(false);
  };

  const playDiagnosisAudio = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95; 
      utterance.pitch = 1.0; 
      utterance.onstart = () => setIsPlayingAudio(true);
      utterance.onend = () => setIsPlayingAudio(false);
      window.speechSynthesis.speak(utterance);
    }
  };

  useEffect(() => {
    let isMounted = true;
    let userId = '';

    const initDashboard = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session && isMounted) {
        router.replace('/auth');
        return;
      }
      if (session && isMounted) {
        userId = session.user.id;
        setCurrentUserId(userId);
        setAccountName(session.user?.user_metadata?.display_name || "Authorized User");
        await fetchHistory(userId);
      }
    };

    initDashboard();

    // 📡 REALTIME LISTENER: Handles both new mappings and AI symptom updates!
    const channel = supabase
      .channel('live-health-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'health_data' }, (payload) => {
          const newData = payload.new as HealthData;
          
          if (newData.user_id === userId) {
            setHistory(prev => {
              // Check if we are updating an existing scan (e.g. typing symptoms)
              const existingIndex = prev.findIndex(item => item.id === newData.id);
              if (existingIndex >= 0) {
                const updatedHistory = [...prev];
                updatedHistory[existingIndex] = newData;
                return updatedHistory;
              } else {
                // It's a brand new scan mapped by Admin
                return [newData, ...prev.slice(0, 14)];
              }
            });
            if (newData.ai_response) playDiagnosisAudio(newData.ai_response);
          }
      }).subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  // ==========================================
  // SYMPTOM SUBMISSION HANDLER
  // ==========================================
  const handleSymptomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symptomInput.trim() || !latestData) return;

    setIsSubmitting(true);
    
    // Generate the personalized AI diagnosis on the frontend
    const updatedAiResponse = generateAdvancedDiagnosticReport(
      latestData.temperature,
      latestData.bpm,
      latestData.spo2,
      accountName.split(" ")[0], // Use first name
      symptomInput
    );

    // Save it to Supabase (which triggers the Realtime listener above to update the UI & play Audio!)
    const { error } = await supabase
      .from('health_data')
      .update({ ai_response: updatedAiResponse })
      .eq('id', latestData.id);

    if (!error) {
      setSymptomInput("");
    }
    setIsSubmitting(false);
  };

  if (loading) return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4 font-mono text-cyan-500 selection:bg-cyan-900">
      <div className="w-12 h-12 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
      <p className="animate-pulse tracking-[0.3em] uppercase text-xs">Syncing A.S.T.R.A Telemetry...</p>
    </div>
  );

  return (
    <main className="min-h-screen bg-black text-white p-6 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* HEADER SECTION */}
        <header className="flex justify-between items-center border-b border-slate-800 pb-6">
          <div>
            <h1 className="text-3xl font-black tracking-tighter bg-gradient-to-r from-cyan-400 to-blue-600 bg-clip-text text-transparent uppercase">
              A.S.T.R.A Terminal
            </h1>
            <p className="text-slate-500 text-[10px] font-bold tracking-[0.3em] uppercase mt-1">Medical Expert Interface v2.5</p>
          </div>
          <div className="flex gap-4 items-center">
            <div className="text-right mr-4">
              <p className="text-slate-500 text-[9px] uppercase font-bold tracking-widest">Profile</p>
              <p className="font-mono text-cyan-400 text-sm tracking-tighter">{accountName}</p>
            </div>
            <button 
              onClick={() => currentUserId && fetchHistory(currentUserId)} 
              className={`p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-cyan-500 transition-all ${isRefreshing ? 'animate-spin' : ''}`}
            >
              🔄
            </button>
            <button 
              onClick={async () => {
                await supabase.auth.signOut();
                router.replace('/auth');
              }}
              className="px-4 py-2 rounded-lg bg-red-900/10 border border-red-900/40 text-red-500 text-[9px] font-black uppercase tracking-widest hover:bg-red-900/20 transition-all"
            >
              Secure Exit
            </button>
          </div>
        </header>

        {/* VITALS GRID */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard icon="🌡️" title="Temperature" value={latestData?.temperature || "--"} unit="°C" color="text-yellow-400" />
          <StatCard icon="❤️" title="Heart Rate" value={latestData?.bpm || "--"} unit="BPM" color="text-red-500" pulse={true} />
          <StatCard icon="💨" title="Oxygen Level" value={latestData?.spo2 || "--"} unit="%" color="text-cyan-400" />
        </div>

        {/* MAIN INTERFACE: DIAGNOSTICS & HISTORY */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* AI DIAGNOSTIC CHAT FEED */}
          <div className="lg:col-span-2 flex flex-col bg-slate-900/50 rounded-[2.5rem] border border-slate-800 h-[550px] overflow-hidden">
            <div className="p-5 bg-slate-950/50 border-b border-slate-800 flex justify-between items-center">
               <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">
                 <span className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse"></span>
                 Diagnostic Analysis
               </h3>
               {isPlayingAudio && <span className="text-[9px] font-bold text-cyan-500 animate-pulse tracking-widest">TRANSMITTING AUDIO...</span>}
            </div>
            
            {/* Messages Feed */}
            <div className="flex-1 overflow-y-auto p-8 space-y-8 scroll-smooth">
               {history.length > 0 ? (
                 history.slice(0, 8).reverse().map((msg) => (
                    <div key={msg.id} className="flex items-start gap-4 animate-in fade-in slide-in-from-left-4">
                       <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-[10px] font-black shadow-lg">AI</div>
                       <div className="flex-1">
                          <div className="bg-slate-800/60 p-5 rounded-2xl rounded-tl-none text-sm font-light leading-relaxed text-slate-200 border border-slate-700/30">
                            {msg.ai_response}
                          </div>
                          <div className="flex items-center gap-3 mt-2">
                             <p className="text-[9px] text-slate-500 uppercase font-black tracking-tighter">
                               {new Date(msg.created_at).toLocaleTimeString()}
                             </p>
                             <div className="w-1 h-1 rounded-full bg-slate-700"></div>
                             <p className="text-[9px] text-cyan-600/60 uppercase font-black tracking-tighter">Verified Session</p>
                          </div>
                       </div>
                    </div>
                 ))
               ) : (
                 <div className="h-full flex items-center justify-center text-slate-600 text-xs font-black uppercase tracking-[0.3em] opacity-40">
                   Awaiting System Input...
                 </div>
               )}
               <div ref={messagesEndRef} />
            </div>

            {/* SYMPTOM INPUT FORM */}
            <form onSubmit={handleSymptomSubmit} className="p-5 bg-slate-950/80 border-t border-slate-800 flex gap-3">
               <input 
                 type="text" 
                 placeholder="Describe your symptoms to refine analysis (e.g. 'I have a headache')..." 
                 value={symptomInput}
                 onChange={(e) => setSymptomInput(e.target.value)}
                 className="flex-1 bg-black border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 text-white placeholder:text-slate-600 transition-all font-medium"
               />
               <button 
                 type="submit"
                 disabled={!symptomInput || !latestData || isSubmitting}
                 className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-black uppercase tracking-widest rounded-xl text-[10px] transition-all shadow-[0_0_15px_rgba(6,182,212,0.15)] disabled:shadow-none"
               >
                 {isSubmitting ? 'Analyzing...' : 'Analyze'}
               </button>
            </form>
          </div>

          {/* COMPACT TELEMETRY LOG */}
          <div className="bg-slate-900/50 rounded-[2.5rem] p-8 border border-slate-800 flex flex-col h-[550px]">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6 border-b border-slate-800 pb-4">
              Historical Scans
            </h3>
            <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-hide">
              {history.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between p-4 rounded-2xl bg-black/40 border border-slate-800/50 hover:bg-slate-800 transition-all group">
                  <div className="space-y-1">
                    <p className="text-[9px] font-mono text-slate-500 group-hover:text-cyan-500 transition-colors uppercase">
                      {new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-[11px] font-black text-slate-300 tracking-tight">{entry.bpm} BPM | {entry.spo2}% SpO2</p>
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
    <div className="bg-slate-900/40 rounded-[2.5rem] p-8 border border-slate-800 transition-all hover:border-slate-700 hover:bg-slate-900/60 group shadow-xl">
      <div className="flex justify-between items-center mb-6">
        <span className="text-4xl group-hover:scale-110 transition-transform duration-300 drop-shadow-lg">{icon}</span>
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