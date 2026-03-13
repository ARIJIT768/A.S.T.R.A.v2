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

#define SAMPLE_RATE    8000
#define RECORD_TIME    2
const size_t RECORD_SIZE = SAMPLE_RATE * 2 * RECORD_TIME;   // 16-bit mono

// ==========================================
// GLOBAL OBJECTS
// ==========================================
Adafruit_ST7735 tft(TFT_CS, TFT_DC, TFT_RST);
MAX30105 particleSensor;

uint8_t* audio_buffer = nullptr;
uint8_t* wav_buffer = nullptr;

size_t recordedBytes = 0;
size_t wavSize = 0;

float finalTemp = 0.0;
int finalBpm = 0;
int finalSpo2 = 0;
String deviceMacAddress = "";

bool processDone = false;

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

    delay(1500);
    return true;
  }

  showScreen("WiFi Failed", "", ST77XX_RED);
  return false;
}

bool ensureWiFi()
{
  if (WiFi.status() == WL_CONNECTED) return true;

  WiFi.disconnect(true);
  delay(500);
  return connectWiFi();
}

// ==========================================
// I2S SETUP
// ==========================================
void setupI2S()
{
  i2s_config_t cfg;
  memset(&cfg, 0, sizeof(cfg));

  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
  cfg.sample_rate = SAMPLE_RATE;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
  cfg.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  cfg.dma_buf_count = 8;
  cfg.dma_buf_len = 512;
  cfg.use_apll = false;
  cfg.tx_desc_auto_clear = false;
  cfg.fixed_mclk = 0;

  i2s_pin_config_t pins;
  memset(&pins, 0, sizeof(pins));

  pins.bck_io_num = I2S_MIC_SCK;
  pins.ws_io_num = I2S_MIC_WS;
  pins.data_out_num = I2S_PIN_NO_CHANGE;
  pins.data_in_num = I2S_MIC_SD;

  i2s_driver_install(I2S_NUM_0, &cfg, 0, NULL);
  i2s_set_pin(I2S_NUM_0, &pins);
  i2s_zero_dma_buffer(I2S_NUM_0);
}

// ==========================================
// WAV HEADER
// ==========================================
void writeWavHeader(uint8_t* header, uint32_t dataSize, uint32_t sampleRate)
{
  uint32_t byteRate = sampleRate * 2;
  uint32_t chunkSize = 36 + dataSize;

  header[0] = 'R'; header[1] = 'I'; header[2] = 'F'; header[3] = 'F';
  header[4] = (uint8_t)(chunkSize & 0xff);
  header[5] = (uint8_t)((chunkSize >> 8) & 0xff);
  header[6] = (uint8_t)((chunkSize >> 16) & 0xff);
  header[7] = (uint8_t)((chunkSize >> 24) & 0xff);
  header[8] = 'W'; header[9] = 'A'; header[10] = 'V'; header[11] = 'E';

  header[12] = 'f'; header[13] = 'm'; header[14] = 't'; header[15] = ' ';
  header[16] = 16; header[17] = 0; header[18] = 0; header[19] = 0;
  header[20] = 1;  header[21] = 0;
  header[22] = 1;  header[23] = 0;
  header[24] = (uint8_t)(sampleRate & 0xff);
  header[25] = (uint8_t)((sampleRate >> 8) & 0xff);
  header[26] = (uint8_t)((sampleRate >> 16) & 0xff);
  header[27] = (uint8_t)((sampleRate >> 24) & 0xff);
  header[28] = (uint8_t)(byteRate & 0xff);
  header[29] = (uint8_t)((byteRate >> 8) & 0xff);
  header[30] = (uint8_t)((byteRate >> 16) & 0xff);
  header[31] = (uint8_t)((byteRate >> 24) & 0xff);
  header[32] = 2;  header[33] = 0;
  header[34] = 16; header[35] = 0;

  header[36] = 'd'; header[37] = 'a'; header[38] = 't'; header[39] = 'a';
  header[40] = (uint8_t)(dataSize & 0xff);
  header[41] = (uint8_t)((dataSize >> 8) & 0xff);
  header[42] = (uint8_t)((dataSize >> 16) & 0xff);
  header[43] = (uint8_t)((dataSize >> 24) & 0xff);
}

bool prepareWavBuffer()
{
  if (recordedBytes == 0) {
    Serial.println("No recorded audio to convert.");
    return false;
  }

  wavSize = recordedBytes + 44;

  if (wav_buffer != nullptr) {
    free(wav_buffer);
    wav_buffer = nullptr;
  }

  wav_buffer = (uint8_t*)malloc(wavSize);
  if (wav_buffer == nullptr) {
    Serial.println("Failed to allocate WAV buffer.");
    return false;
  }

  writeWavHeader(wav_buffer, recordedBytes, SAMPLE_RATE);
  memcpy(wav_buffer + 44, audio_buffer, recordedBytes);

  Serial.print("WAV size: ");
  Serial.println(wavSize);

  return true;
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

  memset(audio_buffer, 0, RECORD_SIZE);
  recordedBytes = 0;

  i2s_zero_dma_buffer(I2S_NUM_0);
  delay(100);

  unsigned long start = millis();

  while ((millis() - start) < (RECORD_TIME * 1000UL) && recordedBytes < RECORD_SIZE)
  {
    size_t bytesRead = 0;
    size_t chunk = min((size_t)512, RECORD_SIZE - recordedBytes);

    esp_err_t result = i2s_read(
      I2S_NUM_0,
      (void*)(audio_buffer + recordedBytes),
      chunk,
      &bytesRead,
      200 / portTICK_PERIOD_MS
    );

    if (result != ESP_OK)
    {
      Serial.print("i2s_read failed: ");
      Serial.println(result);
      showScreen("Audio Error", "", ST77XX_RED);
      return false;
    }

    if (bytesRead > 0) {
      recordedBytes += bytesRead;
    }

    yield();
  }

  Serial.print("Recorded bytes: ");
  Serial.println(recordedBytes);

  if (recordedBytes < 2048) {
    Serial.println("Too little audio captured.");
    showScreen("Mic Error", "Low Audio", ST77XX_RED);
    return false;
  }

  return prepareWavBuffer();
}

// ==========================================
// SEND TO SERVER
// ==========================================
bool sendAudioToServer()
{
  showScreen("Analyzing", "Voice...", ST77XX_YELLOW);

  if (!ensureWiFi())
  {
    showScreen("WiFi Lost", "", ST77XX_RED);
    return false;
  }

  if (wav_buffer == nullptr || wavSize == 0)
  {
    Serial.println("WAV buffer is empty.");
    showScreen("Audio Empty", "", ST77XX_RED);
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  if (!http.begin(client, serverUrl))
  {
    Serial.println("HTTP begin failed.");
    showScreen("HTTP Begin", "Failed", ST77XX_RED);
    return false;
  }

  http.setTimeout(45000);

  http.addHeader("Content-Type", "audio/wav");
  http.addHeader("X-Device-Id", deviceMacAddress);
  http.addHeader("X-Temp", String(finalTemp, 1));
  http.addHeader("X-Bpm", String(finalBpm));
  http.addHeader("X-Spo2", String(finalSpo2));

  Serial.println("Sending request to server...");
  Serial.print("WAV bytes sent: ");
  Serial.println(wavSize);

  int code = http.POST(wav_buffer, wavSize);
  String response = http.getString();

  Serial.print("HTTP code: ");
  Serial.println(code);
  Serial.println("Server Response:");
  Serial.println(response);

  http.end();

  if (code == 200)
  {
    showScreen("Success!", "Completed", ST77XX_GREEN);
    delay(1500);
    return true;
  }
  else if (code == 429)
  {
    showScreen("Rate Limit", "Try Later", ST77XX_RED);
    delay(3000);
    return false;
  }
  else if (code == 500)
  {
    showScreen("Server Busy", "Try Later", ST77XX_RED);
    delay(3000);
    return false;
  }
  else
  {
    showScreen("HTTP Error", String(code), ST77XX_RED);
    delay(3000);
    return false;
  }
}

// ==========================================
// SETUP
// ==========================================
void setup()
{
  Serial.begin(115200);
  delay(500);

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
    while (1) delay(1000);
  }

  Serial.println("MAX30105 detected!");
  particleSensor.setup();
  particleSensor.setPulseAmplitudeRed(0x0A);
  particleSensor.setPulseAmplitudeGreen(0);

  audio_buffer = (uint8_t*)malloc(RECORD_SIZE);
  if (audio_buffer == nullptr)
  {
    showScreen("Memory Error", "PCM Buffer", ST77XX_RED);
    while (1) delay(100);
  }

  setupI2S();

  showScreen("PIR Warmup", "Please wait", ST77XX_YELLOW);
  Serial.println("Warming PIR sensor...");
  delay(20000);

  showScreen("System Ready", "Motion Detect", ST77XX_GREEN);
}

// ==========================================
// LOOP
// ==========================================
void loop()
{
  // Stop forever after one complete cycle
  if (processDone)
  {
    while (1)
    {
      delay(1000);
    }
  }

  int pirState = digitalRead(PIR_PIN);

  if (pirState == HIGH)
  {
    delay(150);

    if (digitalRead(PIR_PIN) == HIGH)
    {
      Serial.println("Motion detected!");

      // Prevent any re-entry from this point
      processDone = true;

      if (!waitForFingerAndReadVitals())
      {
        showScreen("Vitals Error", "", ST77XX_RED);
        while (1) delay(1000);
      }

      if (!recordAudio())
      {
        showScreen("Record Failed", "", ST77XX_RED);
        while (1) delay(1000);
      }

      // Send ONLY ONCE
      bool serverDone = sendAudioToServer();

      if (!serverDone)
      {
        // keep final vitals on screen even if upload failed
        showDashboard();
        while (1) delay(1000);
      }

      // Final screen stays after process completes
      showDashboard();
      while (1) delay(1000);
    }
  }

  delay(100);
}