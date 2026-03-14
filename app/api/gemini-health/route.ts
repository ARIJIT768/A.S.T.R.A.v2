import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ==========================================
// INITIALIZE SUPABASE
// ==========================================
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id, X-Temp, X-Bpm, X-Spo2, X-Patient-Symptoms',
  };
}

function jsonResponse(body: Record<string, any>, status: number, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...corsHeaders(), ...extraHeaders } });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders() });
}

export async function GET() {
  return jsonResponse({ status: 'A.S.T.R.A ADVANCED EXPERT SYSTEM IS ACTIVE' }, 200);
}

// ==========================================
// MASSIVE KEYWORD & VITALS LOGIC ENGINE
// ==========================================
function generateAdvancedDiagnosticReport(temp: number, bpm: number, spo2: number, name: string, patientText: string): string {
  const text = patientText.toLowerCase();

  const hasHeadache = text.includes("headache") || text.includes("head") || text.includes("migraine") || text.includes("dizzy");
  const hasChestPain = text.includes("chest") || text.includes("heart") || text.includes("breath") || text.includes("tightness");
  const hasFatigue = text.includes("tired") || text.includes("weak") || text.includes("fatigue") || text.includes("exhausted") || text.includes("sleepy");
  const hasStomach = text.includes("stomach") || text.includes("nausea") || text.includes("vomit") || text.includes("sick") || text.includes("belly");
  const hasCough = text.includes("cough") || text.includes("throat") || text.includes("cold") || text.includes("sneezing");
  const hasStress = text.includes("stress") || text.includes("anxious") || text.includes("panic") || text.includes("nervous");
  const hasPain = text.includes("pain") || text.includes("hurt") || text.includes("ache") || text.includes("sore");

  const isHighFever = temp >= 39.0;
  const isMildFever = temp > 37.5 && temp < 39.0;
  const isHypothermia = temp < 35.5;
  const isSevereTachycardia = bpm > 120;
  const isTachycardia = bpm > 100 && bpm <= 120;
  const isBradycardia = bpm < 60;
  const isHypoxia = spo2 < 95;

  let response = `Patient ${name} identified. I have processed your symptoms and cross-referenced them with your live telemetry scan. `;

  let detectedSymptoms = [];
  if (hasHeadache) detectedSymptoms.push("cranial discomfort");
  if (hasChestPain) detectedSymptoms.push("respiratory distress");
  if (hasFatigue) detectedSymptoms.push("systemic fatigue");
  if (hasStomach) detectedSymptoms.push("gastrointestinal irregularity");
  if (hasCough) detectedSymptoms.push("respiratory irritation");
  if (hasStress) detectedSymptoms.push("elevated stress");
  if (hasPain && detectedSymptoms.length === 0) detectedSymptoms.push("localized pain");

  if (detectedSymptoms.length > 0) {
    response += `I note that you are experiencing ${detectedSymptoms.join(" and ")}. `;
  }

  if (hasChestPain && (isSevereTachycardia || isHypoxia)) {
    return response + `CRITICAL ALERT: Your chest discomfort combined with abnormal telemetry indicates a medical emergency. Seek assistance immediately.`;
  }
  if (isHighFever) {
    return response + `ALERT: Your core temperature is dangerously elevated at ${temp}°C. Seek immediate medical evaluation.`;
  }
  if (isHypoxia) {
    return response + `ALERT: Your blood oxygen saturation is critical at ${spo2}%. Consult a doctor immediately.`;
  }

  if (hasStress && (isTachycardia || isSevereTachycardia)) {
    response += `Your elevated heart rate of ${bpm} BPM aligns with your reported stress. I recommend a 5-minute breathing exercise.`;
  } else if (isMildFever && hasCough) {
    response += `The combination of a ${temp}°C fever and respiratory symptoms suggests a viral infection. Please rest and hydrate.`;
  } else {
    response += `Your vitals (Temp: ${temp}°C, Pulse: ${bpm} BPM, SpO2: ${spo2}%) indicate you are in stable condition.`;
  }

  return response;
}

// ==========================================
// MAIN POST HANDLER
// ==========================================
export async function POST(request: NextRequest) {
  try {
    const deviceId = request.headers.get('X-Device-Id') || 'ASTRA-DEVICE-01';
    const temp = parseFloat(request.headers.get('X-Temp') || '0');
    const bpm = parseInt(request.headers.get('X-Bpm') || '0', 10);
    const spo2 = parseInt(request.headers.get('X-Spo2') || '0', 10);

    let patientTypedText = "";
    const contentType = request.headers.get('content-type');
    
    // Safety check to prevent crashing on empty JSON bodies
    if (contentType && contentType.includes('application/json')) {
      try {
        const body = await request.json();
        patientTypedText = body?.symptoms || "";
      } catch (e) {
        patientTypedText = request.headers.get('X-Patient-Symptoms') || "";
      }
    } else {
      patientTypedText = request.headers.get('X-Patient-Symptoms') || "";
    }

    if (Number.isNaN(temp) || Number.isNaN(bpm) || Number.isNaN(spo2)) {
      return jsonResponse({ error: 'INVALID_VITALS', message: 'Vitals missing.' }, 400);
    }

    let safeUserId = null;
    let identifiedName = "Unregistered Patient";

    // Lookup user by hardware device_id
    const { data: matchedUser } = await supabaseAdmin
      .from('users')
      .select('id, name')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (matchedUser) {
      safeUserId = matchedUser.id;
      identifiedName = matchedUser.name.split(" ")[0]; 
    }

    const aiResponse = generateAdvancedDiagnosticReport(temp, bpm, spo2, identifiedName, patientTypedText);
    
    // Save to Database - user_id will be NULL if no match, sending it to Admin Portal
    const { error: dbError } = await supabaseAdmin.from('health_data').insert({
      device_id: deviceId,
      user_id: safeUserId,
      temperature: temp,
      bpm,
      spo2,
      ai_response: aiResponse,
      identified_name: identifiedName,
    });

    if (dbError) throw dbError;

    return jsonResponse({
        status: 'Success',
        identified_name: identifiedName,
        ai_response: aiResponse,
      }, 200);

  } catch (error: any) {
    console.error('API Error:', error);
    return jsonResponse({ error: error.message || 'SYSTEM_ERROR' }, 500);
  }
}