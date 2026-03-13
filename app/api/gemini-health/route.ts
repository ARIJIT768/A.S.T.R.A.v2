import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// 1. INITIALIZE CLIENTS
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// WAV Header Helper
function createWavHeader(dataLength: number, sampleRate = 8000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); 
  header.writeUInt16LE(1, 20); 
  header.writeUInt16LE(1, 22); 
  header.writeUInt32LE(sampleRate, 24); 
  header.writeUInt32LE(sampleRate * 2, 28); 
  header.writeUInt16LE(2, 32); 
  header.writeUInt16LE(16, 34); 
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

// ==========================================
// NEW: CORS / PREFLIGHT HANDLER
// ==========================================
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id, X-Temp, X-Bpm, X-Spo2',
    },
  });
}

// ==========================================
// NEW: BROWSER TEST HANDLER
// ==========================================
export async function GET(request: NextRequest) {
  return NextResponse.json(
    { status: "A.S.T.R.A API is ONLINE", message: "Awaiting ESP32 telemetry via POST." }, 
    { status: 200 }
  );
}

// ==========================================
// MAIN ESP32 POST HANDLER
// ==========================================
export async function POST(request: NextRequest) {
  let audioOutputBuffer: Buffer = Buffer.alloc(0);

  try {
    const deviceId = request.headers.get('X-Device-Id') || 'ASTRA-DEVICE-01';
    const temp = parseFloat(request.headers.get('X-Temp') || '0');
    const bpm = parseInt(request.headers.get('X-Bpm') || '0');
    const spo2 = parseInt(request.headers.get('X-Spo2') || '0');

    const { data: allUsers } = await supabaseAdmin.from('users').select('id, name, age, gender');
    const knownUsersString = JSON.stringify(allUsers || []);

    const rawAudio = await request.arrayBuffer();
    const audioData = Buffer.from(rawAudio);

    if (audioData.length === 0) {
      return NextResponse.json({ error: 'No audio detected from ESP32' }, { status: 400 });
    }

    const wavHeader = createWavHeader(audioData.length, 8000);
    const audioForGemini = Buffer.concat([wavHeader, audioData]);

    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash",
      generationConfig: { responseMimeType: "application/json" } 
    }); 

    const prompt = `You are A.S.T.R.A, an AI medical telemetry assistant.
    Registered Users: ${knownUsersString}
    Current Vitals from Hardware: Temp: ${temp}°C, Heart Rate: ${bpm} BPM, Oxygen: ${spo2}%

    Analyze the situation:
    1. Identify the speaker from the audio (use their name if it matches a registered user, otherwise say "Unidentified Patient").
    2. Provide a supportive, concise 2-sentence medical insight based on their vitals. Act like a high-tech AI doctor.
    
    Output JSON ONLY using this exact format:
    {
      "identified_user_id": "UUID string here if matched, otherwise null",
      "identified_name": "Name here",
      "ai_response": "Your 2-sentence medical insight here"
    }`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: audioForGemini.toString("base64"),
          mimeType: "audio/wav"
        }
      }
    ]);

    const aiOutput = JSON.parse(result.response.text());

    await supabaseAdmin.from('health_data').insert({
      device_id: deviceId,
      user_id: aiOutput.identified_user_id || null, 
      temperature: temp,
      bpm: bpm,
      spo2: spo2,
      ai_response: aiOutput.ai_response,
      identified_name: aiOutput.identified_name 
    });

    const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;

    if (elevenLabsApiKey) {
      const ttsResponse = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM/stream?output_format=pcm_16000`, 
        {
          method: 'POST',
          headers: { 
            'xi-api-key': elevenLabsApiKey,
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify({
            text: aiOutput.ai_response,
            model_id: "eleven_turbo_v2", 
          })
        }
      );

      if (ttsResponse.ok) {
        const arrayBuffer = await ttsResponse.arrayBuffer();
        audioOutputBuffer = Buffer.from(arrayBuffer);
      } else {
        audioOutputBuffer = Buffer.alloc(1024); 
      }
    } else {
      audioOutputBuffer = Buffer.alloc(1024);
    }

    return new NextResponse(new Uint8Array(audioOutputBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Identified-Name': aiOutput.identified_name || 'Patient',
        'Access-Control-Allow-Origin': '*' // NEW: CORS header added to response
      },
    });

  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'System Error during API execution' }, { status: 500 });
  }
}