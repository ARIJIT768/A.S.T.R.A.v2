"use client";

import { useState, useEffect } from 'react';
import { supabase } from '../../utils/supabase'; // Verify this path matches your root utils folder
import { useRouter } from 'next/navigation';

export default function MasterAuth() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  
  // OTP Logic State
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [resendTimer, setResendTimer] = useState(0); 

  // UI & Feedback State
  const [pageLoading, setPageLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const router = useRouter();

  useEffect(() => {
    let isMounted = true;

    // Direct session check to prevent logged-in users from seeing this page
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && isMounted) {
        router.replace('/dashboard');
      } else if (isMounted) {
        setPageLoading(false);
      }
    };

    checkSession();

    // Listen for the SIGNED_IN event to trigger the dashboard redirect
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session && isMounted) {
        setSuccessMsg('Authorization Verified. Linking to A.S.T.R.A Core...');
        setTimeout(() => { router.replace('/dashboard'); }, 1500);
      }
    });

    return () => { 
      isMounted = false;
      authListener.subscription.unsubscribe(); 
    };
  }, [router]);

  // Handle OTP Resend countdown
  useEffect(() => {
    let interval: any;
    if (resendTimer > 0) {
      interval = setInterval(() => setResendTimer((prev) => prev - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [resendTimer]);

  const handleAuthAction = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      // 1. Send OTP (Sign up or Sign in)
      const { error } = await supabase.auth.signInWithOtp({ 
        email: email.trim().toLowerCase(),
        options: {
          shouldCreateUser: isSignUp, 
          // Maps to 'name' in your users table via SQL trigger
          data: isSignUp ? { display_name: username.trim() } : undefined
        }
      });

      if (error) throw error;
      
      setIsOtpSent(true);
      setResendTimer(60);
      setSuccessMsg(`Secure code transmitted to ${email}`);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to establish secure link.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setErrorMsg('');

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: otp.trim(),
        type: 'email'
      });

      if (error) throw error;

      // Explicitly redirect on successful verification
      if (data.session) {
        setSuccessMsg("Access Granted.");
        router.replace('/dashboard');
      }
    } catch (err: any) {
      setErrorMsg("Verification Failed: Invalid or expired code.");
      setOtp(''); 
    } finally {
      setActionLoading(false);
    }
  };

  if (pageLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-mono text-cyan-500 animate-pulse uppercase tracking-[0.3em]">
        Authenticating Terminal...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 font-sans">
      
      {/* A.S.T.R.A Branding */}
      <div className="mb-12 text-center">
        <h1 className="text-6xl font-black text-white tracking-tighter bg-gradient-to-r from-cyan-400 to-blue-600 bg-clip-text text-transparent uppercase">
          A.S.T.R.A
        </h1>
        <p className="text-slate-500 text-[10px] font-bold tracking-[0.5em] uppercase mt-2">Secure Health Monitoring Portal</p>
      </div>

      <div className="w-full max-w-md bg-slate-900/50 p-10 rounded-[2.5rem] border border-slate-800 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500 to-transparent"></div>

        <div className="mb-8">
          <h2 className="text-sm font-black text-slate-300 uppercase tracking-widest">
            {isOtpSent ? 'Enter Access Code' : isSignUp ? 'Initialize Registry' : 'Portal Login'}
          </h2>
        </div>

        {errorMsg && <p className="mb-6 p-3 bg-red-900/20 border border-red-900/50 text-red-400 text-[10px] font-bold uppercase tracking-widest text-center rounded-xl">{errorMsg}</p>}
        {successMsg && <p className="mb-6 p-3 bg-cyan-900/20 border border-cyan-800 text-cyan-400 text-[10px] font-bold uppercase tracking-widest text-center rounded-xl">{successMsg}</p>}

        {!isOtpSent ? (
          <form onSubmit={handleAuthAction} className="space-y-6">
            {isSignUp && (
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Full Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. Soham"
                  className="w-full p-4 rounded-xl bg-black border border-slate-800 text-white focus:border-cyan-500 outline-none font-bold text-sm transition-all"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Medical Email</label>
              <input 
                type="email" 
                placeholder="name@email.com"
                className="w-full p-4 rounded-xl bg-black border border-slate-800 text-white focus:border-cyan-500 outline-none font-bold text-sm transition-all"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <button 
              type="submit" 
              disabled={actionLoading}
              className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-black py-4 rounded-xl transition-all uppercase tracking-[0.2em] text-xs disabled:opacity-50"
            >
              {actionLoading ? 'Initializing...' : 'Send Access Code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-6 text-center">
            <input 
              type="text" 
              maxLength={6}
              className="w-full p-4 bg-transparent text-cyan-400 text-5xl font-black tracking-[0.3em] text-center outline-none"
              placeholder="000000"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
            <button 
              type="submit" 
              disabled={actionLoading || otp.length !== 6}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-xl transition-all uppercase tracking-[0.2em] text-xs"
            >
              {actionLoading ? 'Verifying...' : 'Confirm Identity'}
            </button>
            <button 
              type="button"
              onClick={() => setIsOtpSent(false)}
              className="text-[9px] font-black uppercase text-slate-600 hover:text-white transition-colors tracking-widest"
            >
              ← Back to Identification
            </button>
          </form>
        )}
      </div>

      <button 
        onClick={() => {
          setIsSignUp(!isSignUp);
          setErrorMsg(''); 
        }}
        className="mt-10 text-[10px] font-black uppercase tracking-[0.3em] text-slate-600 hover:text-cyan-400 transition-all"
      >
        {isSignUp ? 'Already Registered? Sign-In' : 'New User? Initialize Profile'}
      </button>
    </div>
  );
}