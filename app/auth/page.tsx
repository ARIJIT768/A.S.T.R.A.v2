"use client";

import { useState, useEffect } from 'react';
import { supabase } from '../../utils/supabase'; 
import { useRouter } from 'next/navigation';

export default function AstraAuth() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  
  // OTP State
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [resendTimer, setResendTimer] = useState(0); 

  // Anti-Looping State
  const [pageLoading, setPageLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const router = useRouter();

  useEffect(() => {
    let isMounted = true;

    // 1. Initial Session Check (Stops the Loop!)
    const checkExistingSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && isMounted) {
        router.replace('/dashboard');
      } else if (isMounted) {
        setPageLoading(false);
      }
    };

    checkExistingSession();

    // 2. Listen for successful OTP verify
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session && isMounted) {
        setSuccessMsg('Authorization Verified. Accessing Portal...');
        setTimeout(() => { router.replace('/dashboard'); }, 1000);
      }
    });

    return () => { 
      isMounted = false;
      authListener.subscription.unsubscribe(); 
    };
  }, [router]);

  // Resend Timer countdown
  useEffect(() => {
    let interval: any;
    if (resendTimer > 0) {
      interval = setInterval(() => setResendTimer((prev) => prev - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [resendTimer]);

  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setActionLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const { error } = await supabase.auth.signInWithOtp({ 
        email: email.trim(),
        options: {
          shouldCreateUser: isSignUp, 
          data: isSignUp ? { display_name: username.trim() } : undefined
        }
      });

      if (error) throw error;
      setIsOtpSent(true);
      setResendTimer(60);
      setSuccessMsg('Verification code transmitted to your email.');
    } catch (err: any) {
      setErrorMsg(err.message || "Connection failed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleVerifyOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setActionLoading(true);
    setErrorMsg('');

    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otp.trim(),
        type: 'email'
      });
      if (error) throw error;
    } catch (err: any) {
      setErrorMsg("Invalid or expired code.");
      setOtp(''); 
    } finally {
      setActionLoading(false);
    }
  };

  if (pageLoading) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
          <p className="text-cyan-500 font-black tracking-[0.3em] uppercase text-[10px] animate-pulse">
            Checking Authorization...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#020617] px-4 font-sans selection:bg-cyan-500/30">
      
      {/* Branding Header */}
      <div className="mb-12 text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-cyan-500/10 border border-cyan-500/20 mb-6 shadow-[0_0_50px_rgba(6,182,212,0.1)]">
           <span className="text-cyan-500 text-3xl font-black italic">A</span>
        </div>
        <h1 className="text-4xl font-black text-white tracking-[0.25em] uppercase">A.S.T.R.A</h1>
        <p className="text-slate-500 text-[10px] font-bold tracking-[0.4em] uppercase mt-3">Advanced Systems Telemetry & Remote Assistance</p>
      </div>

      <div className="max-w-md w-full bg-[#0b1120] p-10 rounded-[2.5rem] border border-slate-800 shadow-2xl relative">
        <div className="absolute -top-px left-10 right-10 h-px bg-gradient-to-r from-transparent via-cyan-500 to-transparent"></div>

        <h2 className="text-sm font-black text-slate-400 mb-8 uppercase tracking-[0.2em] text-center">
          {isOtpSent ? 'Authentication Required' : isSignUp ? 'Registry Initialization' : 'System Access'}
        </h2>

        {errorMsg && <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-[10px] font-black uppercase tracking-wider">{errorMsg}</div>}
        {successMsg && <div className="mb-6 p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-2xl text-cyan-400 text-[10px] font-black uppercase tracking-wider">{successMsg}</div>}

        {!isOtpSent ? (
          <form onSubmit={handleSendOtp} className="space-y-6">
            {isSignUp && (
              <input 
                type="text" 
                placeholder="Full Name"
                className="w-full p-5 rounded-2xl bg-[#020617] text-white border border-slate-800 focus:border-cyan-500 outline-none font-bold text-sm tracking-wide transition-all"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            )}
            <input 
              type="email" 
              placeholder="Medical Email"
              className="w-full p-5 rounded-2xl bg-[#020617] text-white border border-slate-800 focus:border-cyan-500 outline-none font-bold text-sm tracking-wide transition-all"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button 
              type="submit" 
              disabled={actionLoading}
              className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-black py-5 rounded-2xl transition-all shadow-lg shadow-cyan-900/20 text-[10px] uppercase tracking-[0.2em]"
            >
              {actionLoading ? 'Processing...' : 'Request Access Code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-6 text-center">
            <input 
              type="text" 
              maxLength={6}
              className="w-full p-6 bg-transparent text-cyan-400 text-5xl font-black tracking-[0.4em] text-center outline-none"
              placeholder="000000"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
            <button 
              type="submit" 
              disabled={actionLoading || otp.length !== 6}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-5 rounded-2xl transition-all text-[10px] uppercase tracking-[0.2em]"
            >
              {actionLoading ? 'Verifying...' : 'Authorize Access'}
            </button>
            <button 
              type="button"
              onClick={() => setIsOtpSent(false)}
              className="mt-6 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white"
            >
              ← Change Credentials
            </button>
          </form>
        )}
      </div>

      <button 
        onClick={() => setIsSignUp(!isSignUp)}
        className="mt-10 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 hover:text-cyan-400"
      >
        {isSignUp ? 'Already Registered? Login' : 'New User? Initialize Registry'}
      </button>
    </div>
  );
}