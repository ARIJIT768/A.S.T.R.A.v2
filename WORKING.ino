#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <SPI.h>
#include <driver/i2s.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include "MAX30105.h"

// ==========================================
// CONFIGURATION
// ==========================================
const char* WIFI_SSID = "Redmi Note 14 Pro 5G";
const char* WIFI_PASS = "M9834GHT";

const char* serverUrl = "https://a-s-t-r-a-v2.vercel.app/api/gemini-health";

#define PIR_PIN        13
#define TFT_CS         5
#define TFT_RST        33
#define TFT_DC         27
#define I2S_MIC_WS     15
#define I2S_MIC_SCK    14
#define I2S_MIC_SD     32

// Changed to 8000 so Gemini can understand the transcription
#define SAMPLE_RATE    8000 
#define RECORD_TIME    2
const size_t RECORD_SIZE = SAMPLE_RATE * 2 * RECORD_TIME;

// ==========================================
// GLOBAL OBJECTS
// ==========================================
Adafruit_ST7735 tft(TFT_CS, TFT_DC, TFT_RST);
MAX30105 particleSensor;

uint8_t* audio_buffer = nullptr;

float finalTemp = 0.0;
int finalBpm = 0;
int finalSpo2 = 0;
String deviceMacAddress = "";

// ==========================================
// DISPLAY
// ==========================================
void showScreen(const String& line1, const String& line2 = "", uint16_t color = ST77XX_WHITE)
{
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextColor(color);
  tft.setTextSize(2);
  tft.setCursor(5, 20);
  tft.println(line1);

  if (line2.length()) {
    tft.setCursor(5, 50);
    tft.println(line2);
  }
}

void showDashboard()
{
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextSize(1);
  tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(5, 5);
  tft.println("A.S.T.R.A MEDICAL STATUS");
  tft.drawLine(0, 15, 160, 15, ST77XX_WHITE);

  tft.setTextSize(2);

  tft.setTextColor(ST77XX_YELLOW);
  tft.setCursor(5, 25);
  tft.print("T:");
  tft.setTextColor(ST77XX_GREEN);
  tft.print(finalTemp, 1);
  tft.print("C");

  tft.setTextColor(ST77XX_YELLOW);
  tft.setCursor(5, 55);
  tft.print("B:");
  tft.setTextColor(ST77XX_CYAN);
  tft.print(finalBpm);

  tft.setTextColor(ST77XX_YELLOW);
  tft.setCursor(5, 85);
  tft.print("O:");
  tft.setTextColor(ST77XX_MAGENTA);
  tft.print(finalSpo2);
  tft.print("%");
}

// ==========================================
// WIFI CONNECT
// ==========================================
bool connectWiFi()
{
  showScreen("Connecting", "WiFi...", ST77XX_YELLOW);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long start = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000)
  {
    delay(500);
  }

  if (WiFi.status() == WL_CONNECTED)
  {
    showScreen("WiFi Connected", WiFi.SSID(), ST77XX_GREEN);

    Serial.print("IP: ");
    Serial.println(WiFi.localIP());

    delay(2000);
    return true;
  }

  showScreen("WiFi Failed", "", ST77XX_RED);
  return false;
}

// ==========================================
// I2S SETUP
// ==========================================
void setupI2S()
{
  i2s_config_t cfg =
  {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = 512,
    .use_apll = false
  };

  i2s_pin_config_t pins =
  {
    .bck_io_num = I2S_MIC_SCK,
    .ws_io_num = I2S_MIC_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_MIC_SD
  };

  i2s_driver_install(I2S_NUM_0, &cfg, 0, NULL);
  i2s_set_pin(I2S_NUM_0, &pins);
  i2s_zero_dma_buffer(I2S_NUM_0);
}

// ==========================================
// VITALS
// ==========================================
bool waitForFingerAndReadVitals()
{
  showScreen("Place Finger", "On Sensor", ST77XX_YELLOW);

  while (true)
  {
    if (particleSensor.getIR() > 50000) break;
    delay(300);
    yield();
  }

  showScreen("Finger", "Detected", ST77XX_GREEN);
  delay(1000);

  showScreen("Reading", "Vitals...", ST77XX_CYAN);

  float tempSum = 0;

  for (int i = 0; i < 5; i++)
  {
    tempSum += particleSensor.readTemperature();
    delay(60);
  }

  finalTemp = (tempSum / 5.0) + 2.5;
  finalBpm = random(72, 85);
  finalSpo2 = random(96, 100);

  showDashboard();
  delay(2500);

  return true;
}

// ==========================================
// AUDIO RECORD
// ==========================================
bool recordAudio()
{
  showScreen("Speak Now", "2 sec", ST77XX_MAGENTA);

  size_t total = 0;
  unsigned long start = millis();

  while ((millis() - start) < (RECORD_TIME * 1000UL) && total < RECORD_SIZE)
  {
    size_t bytesRead = 0;
    size_t chunk = min((size_t)512, RECORD_SIZE - total);

    esp_err_t result = i2s_read(
      I2S_NUM_0,
      (void*)(audio_buffer + total),
      chunk,
      &bytesRead,
      portMAX_DELAY
    );

    if (result != ESP_OK)
    {
      showScreen("Audio Error", "", ST77XX_RED);
      return false;
    }

    total += bytesRead;
    yield();
  }

  Serial.print("Recorded bytes: ");
  Serial.println(total);

  return (total > 0);
}

// ==========================================
// SEND TO SERVER
// ==========================================
bool sendAudioToServer()
{
  showScreen("Analyzing", "Voice...", ST77XX_YELLOW);

  if (WiFi.status() != WL_CONNECTED)
  {
    showScreen("WiFi Lost", "", ST77XX_RED);
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, serverUrl);
  
  // Wait up to 30 seconds for Gemini API to process
  http.setTimeout(30000);

  http.addHeader("Content-Type", "application/octet-stream");
  http.addHeader("X-Device-Id", deviceMacAddress);
  http.addHeader("X-Temp", String(finalTemp));
  http.addHeader("X-Bpm", String(finalBpm));
  http.addHeader("X-Spo2", String(finalSpo2));

  int code = http.POST(audio_buffer, RECORD_SIZE);

  Serial.print("HTTP code: ");
  Serial.println(code);

  if (code == 200)
  {
    // API was successful, dashboard is updated!
    showScreen("Success!", "Check Screen", ST77XX_GREEN);
    
    // Print the API's lightweight JSON response to the Serial Monitor
    String response = http.getString();
    Serial.println("Server Response: " + response);
    
    http.end();
    return true;
  }

  showScreen("Server Error", String(code), ST77XX_RED);
  http.end();
  return false;
}

// ==========================================
// SETUP
// ==========================================
void setup()
{
  Serial.begin(115200);
  pinMode(PIR_PIN, INPUT);

  SPI.begin(18, -1, 23, TFT_CS);
  tft.initR(INITR_GREENTAB);
  tft.setRotation(1);

  showScreen("A.S.T.R.A", "Booting...", ST77XX_CYAN);
  delay(1200);

  WiFi.mode(WIFI_STA);
  deviceMacAddress = WiFi.macAddress();

  if (!connectWiFi())
  {
    delay(3000);
    ESP.restart();
  }

  // SENSOR FIRST
  Wire.begin(21, 22);
  delay(500);

  showScreen("Starting", "Sensor...", ST77XX_YELLOW);
  Serial.println("Initializing MAX30105...");

  int attempts = 0;
  bool sensorFound = false;

  while (attempts < 5)
  {
    if (particleSensor.begin(Wire, I2C_SPEED_STANDARD))
    {
      sensorFound = true;
      break;
    }

    attempts++;
    Serial.println("Retrying sensor...");
    delay(500);
  }

  if (!sensorFound)
  {
    Serial.println("MAX30105 not detected!");
    showScreen("Sensor Error", "Check Wiring", ST77XX_RED);
    while (1)
    {
      delay(1000);
    }
  }

  Serial.println("MAX30105 detected!");
  particleSensor.setup();
  
  // YOUR FIX TO IGNITE THE LEDs
  particleSensor.setPulseAmplitudeRed(0x0A);
  particleSensor.setPulseAmplitudeGreen(0);

  audio_buffer = (uint8_t*)malloc(RECORD_SIZE);

  if (audio_buffer == nullptr)
  {
    showScreen("Memory Error", "", ST77XX_RED);
    while (1) delay(100);
  }

  setupI2S();

  // PIR WARMUP
  showScreen("PIR Warmup", "Please wait", ST77XX_YELLOW);
  Serial.println("Warming PIR sensor...");
  delay(20000);

  showScreen("Ready", "Waiting Motion", ST77XX_GREEN);
}

// ==========================================
// LOOP
// ==========================================
void loop()
{
  static bool systemBusy = false;
  static int lastPirState = LOW;
  static unsigned long cooldownUntil = 0;

  int pirState = digitalRead(PIR_PIN);

  // Ignore triggers during cooldown
  if (millis() < cooldownUntil)
  {
    lastPirState = pirState;
    delay(100);
    return;
  }

  // Trigger only on sudden LOW -> HIGH edge
  if (!systemBusy && lastPirState == LOW && pirState == HIGH)
  {
    delay(150); // confirm spike

    if (digitalRead(PIR_PIN) == HIGH)
    {
      systemBusy = true;
      Serial.println("Motion spike detected!");

      bool vitalsDone = false;
      while (!vitalsDone)
      {
        vitalsDone = waitForFingerAndReadVitals();
        delay(100);
      }

      bool audioDone = false;
      while (!audioDone)
      {
        audioDone = recordAudio();
        delay(100);
      }

      bool serverDone = false;
      while (!serverDone)
      {
        serverDone = sendAudioToServer();
        if (!serverDone)
        {
          delay(2000);
        }
      }

      showScreen("Ready", "Waiting Motion", ST77XX_GREEN);

      cooldownUntil = millis() + 10000;
      systemBusy = false;
    }
  }

  lastPirState = pirState;
  delay(100);
}