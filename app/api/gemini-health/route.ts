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

  // 1. KEYWORD SCANNERS (Symptom Tracking)
  const hasHeadache = text.includes("headache") || text.includes("head") || text.includes("migraine") || text.includes("dizzy");
  const hasChestPain = text.includes("chest") || text.includes("heart") || text.includes("breath") || text.includes("tightness");
  const hasFatigue = text.includes("tired") || text.includes("weak") || text.includes("fatigue") || text.includes("exhausted") || text.includes("sleepy");
  const hasStomach = text.includes("stomach") || text.includes("nausea") || text.includes("vomit") || text.includes("sick") || text.includes("belly");
  const hasCough = text.includes("cough") || text.includes("throat") || text.includes("cold") || text.includes("sneezing");
  const hasStress = text.includes("stress") || text.includes("anxious") || text.includes("panic") || text.includes("nervous");
  const hasPain = text.includes("pain") || text.includes("hurt") || text.includes("ache") || text.includes("sore");

  // 2. HARDWARE SCANNERS (Vitals Tracking)
  const isHighFever = temp >= 39.0;
  const isMildFever = temp > 37.5 && temp < 39.0;
  const isHypothermia = temp < 35.5;
  const isSevereTachycardia = bpm > 120;
  const isTachycardia = bpm > 100 && bpm <= 120;
  const isBradycardia = bpm < 60;
  const isHypoxia = spo2 < 95;

  // 3. BUILD THE GREETING
  let response = `Patient ${name} identified. I have processed your typed symptoms and cross-referenced them with your live telemetry scan. `;

  // 4. BUILD THE SYMPTOM ACKNOWLEDGMENT
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

  // 5. THE MEDICAL CROSS-REFERENCE ENGINE (Advanced Pre-Baked Logic)
  
  // CRITICAL EMERGENCIES
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
  
  // ASYMMETRICAL CONDITIONS (Symptoms don't match vitals)
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

// ==========================================
// MAIN POST HANDLER
// ==========================================
export async function POST(request: NextRequest) {
  try {
    const deviceId = request.headers.get('X-Device-Id') || 'ASTRA-DEVICE-01';
    const temp = parseFloat(request.headers.get('X-Temp') || '0');
    const bpm = parseInt(request.headers.get('X-Bpm') || '0', 10);
    const spo2 = parseInt(request.headers.get('X-Spo2') || '0', 10);

    // 🔥 THE NEW TEXT INPUT CAPABILITY
    // The API will now try to read a typed message from the JSON body,
    // or fall back to a header if sent via the ESP32.
    let patientTypedText = "";
    try {
      const body = await request.json();
      patientTypedText = body.symptoms || "";
    } catch (e) {
      patientTypedText = request.headers.get('X-Patient-Symptoms') || "";
    }

    if (Number.isNaN(temp) || Number.isNaN(bpm) || Number.isNaN(spo2)) {
      return jsonResponse({ error: 'INVALID_VITALS', message: 'Vitals missing.' }, 400);
    }

    let safeUserId = null;
    let identifiedName = "Unregistered Patient";

    // Find the specific user who owns this exact ESP32 MAC Address!
    const { data: matchedUser, error } = await supabaseAdmin
      .from('users')
      .select('id, name')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (matchedUser) {
      safeUserId = matchedUser.id;
      identifiedName = matchedUser.name.split(" ")[0]; 
    }

    // Generate Advanced Diagnosis
    const aiResponse = generateAdvancedDiagnosticReport(temp, bpm, spo2, identifiedName, patientTypedText);
    
    // Save to Database
    await supabaseAdmin.from('health_data').insert({
      device_id: deviceId,
      user_id: safeUserId,
      temperature: temp,
      bpm,
      spo2,
      ai_response: aiResponse,
      identified_name: identifiedName,
    });

    return jsonResponse({
        status: 'Success',
        identified_name: identifiedName,
        ai_response: aiResponse,
      }, 200);

  } catch (error: any) {
    console.error('API Error:', error);
    return jsonResponse({ error: 'SYSTEM_ERROR' }, 500);
  }
}