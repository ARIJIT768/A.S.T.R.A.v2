import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// 1. INITIALIZE CLIENTS
// Using the Service Role Key bypasses RLS so the ESP32 can save data without "logging in"
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// WAV Header Helper: Converts raw 8kHz PCM from ESP32 into a format Gemini can "hear"
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
  let audioOutputBuffer: Buffer = Buffer.alloc(0);

  try {
    // 2. EXTRACT TELEMETRY FROM ESP32
    const deviceId = request.headers.get('X-Device-Id') || 'ASTRA-DEVICE-01';
    const temp = parseFloat(request.headers.get('X-Temp') || '0');
    const bpm = parseInt(request.headers.get('X-Bpm') || '0');
    const spo2 = parseInt(request.headers.get('X-Spo2') || '0');

    // 3. FETCH REGISTERED USERS
    // We pass this list to Gemini so it knows who it's talking to
    const { data: allUsers } = await supabaseAdmin.from('users').select('id, name, age, gender');
    const knownUsersString = JSON.stringify(allUsers || []);

    // 4. EXTRACT AUDIO BUFFER
    const rawAudio = await request.arrayBuffer();
    const audioData = Buffer.from(rawAudio);

    if (audioData.length === 0) {
      return NextResponse.json({ error: 'No audio detected from ESP32' }, { status: 400 });
    }

    // Wrap the raw ESP32 audio in a standard WAV header
    const wavHeader = createWavHeader(audioData.length, 8000);
    const audioForGemini = Buffer.concat([wavHeader, audioData]);

    // 5. EXECUTE GEMINI 2.0 FLASH ANALYSIS
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash",
      // Force the AI to output pure JSON so our code doesn't crash parsing text
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

    // Safely parse the AI output
    const aiOutput = JSON.parse(result.response.text());

    // 6. DASHBOARD SYNCHRONIZATION (THE MAGIC LINK)
    // The moment this insert happens, Supabase Realtime pushes it to your Next.js Dashboard
    await supabaseAdmin.from('health_data').insert({
      device_id: deviceId,
      user_id: aiOutput.identified_user_id || null, // Handles null if user is unknown
      temperature: temp,
      bpm: bpm,
      spo2: spo2,
      ai_response: aiOutput.ai_response,
      identified_name: aiOutput.identified_name 
    });

    // 7. TEXT-TO-SPEECH (ELEVENLABS)
    const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;

    if (elevenLabsApiKey) {
      // Note: pcm_16000 matches standard ESP32 audio buffers. 
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
        console.error("ElevenLabs API error. Check your API key or quota.");
        audioOutputBuffer = Buffer.alloc(1024); // Prevent crash by sending silent buffer
      }
    } else {
      console.warn("No ElevenLabs Key found in .env.local. Sending silent buffer.");
      audioOutputBuffer = Buffer.alloc(1024);
    }

   // 8. SEND AUDIO BACK TO ESP32
    return new NextResponse(new Uint8Array(audioOutputBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Identified-Name': aiOutput.identified_name || 'Patient'
      },
    });

  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'System Error during API execution' }, { status: 500 });
  }
}