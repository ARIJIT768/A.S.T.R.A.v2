import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// 1. Initialize Clients
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// WAV Header Helper (Converts raw 8kHz PCM from ESP32 for Gemini)
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

export async function POST(request: NextRequest) {
  // Declare the buffer at the top of the function scope so it's accessible everywhere
  let audioOutputBuffer: Buffer = Buffer.alloc(0);

  try {
    // 2. Extract Telemetry from ESP32 Headers
    const deviceId = request.headers.get('X-Device-Id') || 'ASTRA-DEVICE-01';
    const temp = request.headers.get('X-Temp') || '0';
    const bpm = request.headers.get('X-Bpm') || '0';
    const spo2 = request.headers.get('X-Spo2') || '0';

    // 3. Fetch Registered Users for Personalization
    const { data: allUsers } = await supabaseAdmin.from('users').select('id, name, age, gender');
    const knownUsersString = JSON.stringify(allUsers || []);

    // 4. Extract Audio Buffer
    const rawAudio = await request.arrayBuffer();
    const audioData = Buffer.from(rawAudio);

    if (audioData.length === 0) {
      return NextResponse.json({ error: 'No audio detected' }, { status: 400 });
    }

    const wavHeader = createWavHeader(audioData.length, 8000);
    const audioForGemini = Buffer.concat([wavHeader, audioData]);

    // 5. Execute Gemini 2.0 Flash Analysis
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash",
      generationConfig: { responseMimeType: "application/json" } 
    }); 

    const prompt = `You are A.S.T.R.A, an AI medical telemetry assistant.
    Registered Users: ${knownUsersString}
    Current Vitals: Temp: ${temp}°C, Heart Rate: ${bpm} BPM, Oxygen: ${spo2}%

    Analyze:
    1. Identify the speaker from the audio.
    2. Provide a supportive 2-sentence medical insight based on their vitals and identity.
    
    Output JSON ONLY:
    {
      "identified_user_id": "string or null",
      "identified_name": "string",
      "ai_response": "string"
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

    // 6. Database Synchronization (Crucial for Dashboard Realtime)
    await supabaseAdmin.from('health_data').insert({
      device_id: deviceId,
      user_id: aiOutput.identified_user_id,
      temperature: parseFloat(temp),
      bpm: parseInt(bpm),
      spo2: parseInt(spo2),
      ai_response: aiOutput.ai_response,
      identified_name: aiOutput.identified_name 
    });

    // 7. Text-To-Speech (ElevenLabs)
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
        console.error("ElevenLabs API error detected.");
        audioOutputBuffer = Buffer.alloc(1024); // Minimal silent buffer
      }
    } else {
      console.warn("No ElevenLabs Key: Sending silent buffer.");
      audioOutputBuffer = Buffer.alloc(1024);
    }

   // 8. Final Return (Uses the successfully populated buffer)
    return new NextResponse(new Uint8Array(audioOutputBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Identified-Name': aiOutput.identified_name || 'Patient'
      },
    });

  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'System Error' }, { status: 500 });
  }
}