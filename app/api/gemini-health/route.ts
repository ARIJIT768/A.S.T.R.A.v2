import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ==========================================
// INITIALIZE CLIENTS
// ==========================================
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// ==========================================
// HELPERS
// ==========================================
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id, X-Temp, X-Bpm, X-Spo2',
  };
}

function jsonResponse(body: Record<string, any>, status: number, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...corsHeaders(), ...extraHeaders },
  });
}

// ==========================================
// CORS / PREFLIGHT HANDLER
// ==========================================
export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders() });
}

// ==========================================
// BROWSER TEST HANDLER
// ==========================================
export async function GET() {
  return jsonResponse({ status: 'A.S.T.R.A API is ONLINE', message: 'Awaiting ESP32 telemetry via POST.' }, 200);
}

// ==========================================
// MAIN ESP32 POST HANDLER
// ==========================================
export async function POST(request: NextRequest) {
  try {
    const deviceId = request.headers.get('X-Device-Id') || 'ASTRA-DEVICE-01';
    const temp = parseFloat(request.headers.get('X-Temp') || '0');
    const bpm = parseInt(request.headers.get('X-Bpm') || '0', 10);
    const spo2 = parseInt(request.headers.get('X-Spo2') || '0', 10);

    const { data: allUsers } = await supabaseAdmin.from('users').select('id, name, age, gender');
    const knownUsersString = JSON.stringify(allUsers || []);

    const rawAudio = await request.arrayBuffer();
    const audioBuffer = Buffer.from(rawAudio);

    if (!audioBuffer || audioBuffer.length === 0) {
      return jsonResponse({ error: 'NO_AUDIO', message: 'No audio detected from ESP32.' }, 400);
    }

    if (Number.isNaN(temp) || Number.isNaN(bpm) || Number.isNaN(spo2)) {
      return jsonResponse({ error: 'INVALID_VITALS', message: 'Temperature, BPM, or SpO2 is missing or invalid.' }, 400);
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: { responseMimeType: 'application/json' },
    });

    const prompt = `You are A.S.T.R.A, an AI medical telemetry assistant.
    Registered Users: ${knownUsersString}
    Current patient vitals: Temp: ${temp}°C, Heart Rate: ${bpm} BPM, Oxygen: ${spo2}%

    Analyze the situation:
    1. Identify the speaker from the audio (use their name if it matches a registered user, otherwise say "Unidentified Patient").
    2. Provide a supportive, concise 2-sentence medical insight based on their vitals.
    
    Output JSON ONLY using exactly this schema:
    {
      "identified_user_id": "UUID string here if matched, otherwise null",
      "identified_name": "Name here",
      "ai_response": "Your 2-sentence medical insight here"
    }`;

    let safeUserId = null;
    let identifiedName = "Unknown Patient";
    let aiResponse = "";

    // ==========================================
    // THE RATE-LIMIT SHIELD
    // ==========================================
    try {
      const result = await model.generateContent([
        prompt,
        { inlineData: { data: audioBuffer.toString("base64"), mimeType: "audio/wav" } }
      ]);

      let rawText = result.response.text();
      rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      
      // 🔥 LOG RAW TEXT TO VERCEL DASHBOARD
      console.log("=== RAW GEMINI TEXT ===", rawText);
      
      let aiOutput = JSON.parse(rawText);
      
      // 🔥 LOG PARSED JSON TO VERCEL DASHBOARD
      console.log("=== PARSED JSON OBJECT ===", aiOutput);

      safeUserId = aiOutput.identified_user_id;
      if (safeUserId === "null" || safeUserId === "None" || safeUserId === "") {
        safeUserId = null;
      }
      identifiedName = aiOutput.identified_name || "Unknown Patient";
      aiResponse = aiOutput.ai_response || "Telemetry recorded.";

    } catch (geminiError: any) {
      console.error('Gemini API hit a snag (Rate Limit or Timeout):', geminiError);
      
      // THE FALLBACK: If Gemini blocks us, use this emergency response instead of crashing!
      identifiedName = "Unidentified Patient";
      aiResponse = "A.S.T.R.A servers are currently busy due to high traffic, but your vitals have been successfully recorded.";
    }

    // ==========================================
    // SAVE TO DATABASE (ALWAYS HAPPENS)
    // ==========================================
    const { error: insertError } = await supabaseAdmin.from('health_data').insert({
      device_id: deviceId,
      user_id: safeUserId,
      temperature: temp,
      bpm,
      spo2,
      ai_response: aiResponse,
      identified_name: identifiedName,
    });

    if (insertError) {
      return jsonResponse({ error: 'DATABASE_INSERT_FAILED', message: insertError.message }, 500);
    }

    // ==========================================
    // SUCCESS RESPONSE (ESP32 ALWAYS GETS 200 OK)
    // ==========================================
    return jsonResponse({
        status: 'Success',
        message: 'Data saved to dashboard.',
        identified_name: identifiedName,
        ai_response: aiResponse,
      }, 200);

  } catch (error: any) {
    console.error('API Error:', error);
    return jsonResponse({ error: 'SYSTEM_ERROR', message: error?.message || 'System Error' }, 500);
  }
}