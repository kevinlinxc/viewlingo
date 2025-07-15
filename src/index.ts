import { AppServer, AppSession, ViewType, AuthenticatedRequest, PhotoData } from '@mentra/sdk';
import { Request, Response } from 'express';
import * as ejs from 'ejs';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { GoogleGenerativeAI } from '@google/generative-ai';


/**
 * Interface representing a word entry to be sent to the API
 */
interface WordEntry {
  word: string;
  translation: string;
  anglosax: string;
  picture: string;
  timestamp: string;
  language: string;
  id: number;
}

const PACKAGE_NAME = process.env.PACKAGE_NAME ?? (() => { throw new Error('PACKAGE_NAME is not set in .env file'); })();
const MENTRAOS_API_KEY = process.env.MENTRAOS_API_KEY ?? (() => { throw new Error('MENTRAOS_API_KEY is not set in .env file'); })();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? (() => { throw new Error('GEMINI_API_KEY is not set in .env file'); })();
const API_ENDPOINT = process.env.API_ENDPOINT ?? (() => { throw new Error('API_ENDPOINT is not set in .env file'); })();
const PORT = parseInt(process.env.PORT || '3000');


/**
 * Analyzes an image and translates the subject to Mandarin Chinese using the Gemini API
 * @param imageBytes - The image data as a Buffer
 * @param mimeType - The MIME type of the image
 * @returns Promise<{word: string, characters: string, anglicized: string}> - The analysis and translation result
 */
async function analyzeAndTranslateWithGemini(imageBytes: Buffer, mimeType: string, language: string = "Mandarin"): Promise<{word: string, characters: string, anglicized: string}> {
  try {
    console.log(`Calling Gemini API to analyze image and translate subject to ${language}...`);
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const imagePart = {
      inlineData: {
        data: imageBytes.toString('base64'),
        mimeType: mimeType,
      },
    };

    const formatPrompt = '{"word": "", "characters": "", "anglicized": ""}';
    const prompt = `Analyze the subject of this image (just one subject, in minimum number of words, no adjectives or punctuation) and translate it to ${language}. Answer in this JSON format: ${formatPrompt}, with no other formatting, backticks, or padding. The word key should be in english.`;

    
    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    let text = response.text();
    // if the response starts with ```, delete the first line, and the last line
    if (text.startsWith('```')) {
      const lines = text.split('\n');
      lines.shift(); // Remove the first line
      lines.pop(); // Remove the last line
      text = lines.join('\n');
    }

    console.log('Gemini combined response:', text);

    // Parse the JSON response
    const analysisAndTranslation = JSON.parse(text.trim());
    return analysisAndTranslation;
  } catch (error) {
    console.error('Error analyzing and translating with Gemini API:', error);
    throw error;
  }
}


async function translateWithGemini(wordOrPhrase: string, language: string = "Mandarin Chinese"): Promise<{characters: string, anglicized: string}> {
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const formatPrompt = '{"characters": "", "anglicized": ""}';
    const prompt = `What is \`${wordOrPhrase}\` in ${language}? Answer in this JSON format: ${formatPrompt}, with no other formatting or padding`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    // if the response starts with ```, delete the first line, and the last line
    if (text.startsWith('```')) {
      const lines = text.split('\n');
      lines.shift(); // Remove the first line
      lines.pop(); // Remove the last line
      text = lines.join('\n');
    }
    
    console.log('Gemini translation response:', text);
    
    // Parse the JSON response
    const translation = JSON.parse(text.trim());
    return translation;
  } catch (error) {
    console.error('Error translating with Gemini API:', error);
    throw error;
  }
}

/**
 * Sends a word entry to the external API
 * @param wordData - The word entry data to send
 * @returns Promise<void>
 */
async function sendWordToAPI(wordData: WordEntry): Promise<void> {
  try {
    console.log(`Sending word data to API: ${API_ENDPOINT}`);
    const response = await fetch(`${API_ENDPOINT}/words`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify(wordData)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}, ${response.statusText}`);
    }

    const result = await response.json();
    console.log('Word successfully sent to API:', result);
  } catch (error) {
    console.error('Error sending word to API:', error);
    throw error;
  }
}


async function sendLocationToAPI(location: string, translated_location: string, translated_location_anglicized: string): Promise<void> {
  try {
    const response = await fetch(`https://surface-walls-handle-rows.trycloudflare.com/locations`, {
      method: 'POST',
      headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify({ name: location, translated_name: translated_location, translated_name_anglicized: translated_location_anglicized })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}, ${response.statusText}`);
    }

    const result = await response.json();
    console.log('Location successfully sent to API:', result);
  } catch (error) {
    console.error('Error sending location to API:', error);
    throw error;
  }
}

/**
 * Get location name from latitude and longitude using Nominatim reverse geocoding
 * @param lat - Latitude
 * @param lon - Longitude
 * @returns Promise<string> - Location description
 */
async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`;
    console.log(`Reverse geocoding lat and long...`);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ViewLingo/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    // Extract meaningful location info
    // console.log('Reverse geocode data:', data);
    const address = data.address;
    return address["city"];  // could do cooler stuff later but city for now
  } catch (error) {
    console.error('Error reverse geocoding:', error);
    return 'Location unavailable';
  }
}


async function getObjectsFromRoboflow(imageBuffer: Buffer): Promise<any[]> {
  try {
    const base64Image = imageBuffer.toString("base64");

    const response = await fetch('https://serverless.roboflow.com/infer/workflows/viewlingo/custom-workflow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: '02ovWJL9iw4AFK4di9sS',
        inputs: {
          "image": { "type": "base64", "value": base64Image }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Roboflow API request failed with status ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    // console.log(result);
    // console.log(result.outputs[0].model_predictions)
    let predictions = result.outputs[0].model_predictions.predictions;
    console.log(predictions);
    if (Array.isArray(predictions)) {
      const uniqueClasses = Array.from(new Set(predictions.map((prediction: { class: string }) => prediction.class)));
      console.log('Roboflow unique classes:', uniqueClasses);
      console.log('Printing unique classes as a list:');
      return uniqueClasses
    } else {
      console.error('Predictions is not an array:', predictions);
    }
    return [];
  } catch (error) {
    console.error("Error calling Roboflow API:", error);
    return [];
  }
}
/**
 */
class ViewLingo extends AppServer {
  private currentWordData: WordEntry | null = null;
  private listeningUntil: number = 0; // Timestamp when listening expires
  private readonly LISTENING_DURATION_MS = 25000; // 25 secondsunrelate
  private customPrompt: string = "You are a language learning assistant. The user just learned about this word: {word} ({translation} - {anglicized}). Please respond helpfully to their question or comment about this word. Keep the response short and relevant.";
  private trackingLocation: boolean = false;
  private currentLanguage: string = "Mandarin"; // Default language
  
  constructor() {
    super({
      packageName: PACKAGE_NAME,
      apiKey: MENTRAOS_API_KEY,
      port: PORT,
    });
  }

  /**
   * Toggle between Mandarin and Korean languages
   */
  private toggleLanguage(): string {
    if (this.currentLanguage === "Mandarin") {
      this.currentLanguage = "Korean";
    } else {
      this.currentLanguage = "Mandarin";
    }
    return this.currentLanguage;
  }

  /**
   * Send text prompt to Gemini with current word context
   */
  async sendPromptToGemini(text: string): Promise<string> {
    try {
      if (!this.currentWordData) {
        console.error('No current word data available.');
        return '';
      }
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      let prompt = this.customPrompt;
      
      // Replace placeholders with current word data
      if (this.currentWordData) {
        prompt = prompt.replace('{word}', this.currentWordData.word);
        prompt = prompt.replace('{translation}', this.currentWordData.translation);
        prompt = prompt.replace('{anglicized}', this.currentWordData.anglosax);
      }
      
      const fullPrompt = `${prompt}\n\nUser said: "${text}"`;
      
      const result = await model.generateContent(fullPrompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('Error sending prompt to Gemini:', error);
      throw error;
    }
  }

  /**
   * Set listening state to active for the configured duration
   */
  private setListening(): void {
    this.listeningUntil = Date.now() + this.LISTENING_DURATION_MS;
    console.log(`Listening activated. You have ${this.LISTENING_DURATION_MS / 1000} seconds.`);
  }

  /**
   * Check if currently in listening state
   */
  private isListening(): boolean {
    return Date.now() < this.listeningUntil;
  }

  /**
   * Handle new session creation and button press events
   */
  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    // this gets called whenever a user launches the app


    console.log(`Session started for user ${userId}`);
    if (this.trackingLocation){
      const location = await session.location.getLatestLocation({ accuracy: 'standard' });
      const city = await reverseGeocode(location.lat, location.lng);
      console.log(`Lat: ${location.lat}, Lng: ${location.lng}, ${city}`);
      const translated_city = await translateWithGemini(city);
      console.log(`Translated city: ${translated_city.characters} (${translated_city.anglicized})`);
      sendLocationToAPI(city, translated_city.characters, translated_city.anglicized);

      // const translated_city = 
    }

    // set the initial state of the user

    let cleanup1 = session.events.onTranscription(async (data) => {
      // Only process final transcriptions when listening
      console.log(`Transcription event received: ${data.text}`);
      if ("stop" in data.text.toLowerCase) {
        this.listeningUntil = Date.now() - 1000; // Reset listening state if "stop" is detected
      }
      if (this.isListening() && data.isFinal && (data.text.toLowerCase().includes("can you") || data.text.toLowerCase().includes("what is") || data.text.toLowerCase().includes("how"))) {
        console.log(`Final transcription received: ${data.text}`);
        
        try {
          // Send transcription to Gemini with current word context
          const geminiResponse = await this.sendPromptToGemini(data.text);
          console.log(`Gemini response: ${geminiResponse}`);
          
            if (geminiResponse.trim() != '') {
                // Display and speak the response
                await this.speakToUser(session, geminiResponse);
                this.setListening(); 
                // 
            }
             

          
        } catch (error) {
          console.error('Error processing transcription with Gemini:', error);
        }
      }
    });
    // // this gets called whenever a user presses a button
    session.events.onButtonPress(async (button) => {
      console.log(`Button pressed: ${button.buttonId}, type: ${button.pressType}`);

      if (button.pressType === 'long') {
        // Toggle language on long press
        const newLanguage = this.toggleLanguage();
        console.log(`Language switched to: ${newLanguage}`);
        await this.speakToUser(session, `Switched to ${newLanguage}`);
        return;
      } else {
        console.log(`User short pressed, taking photo`);
        await this.speakToUser(session, "Hold still!");
        // the user pressed the button, so we take a single photo
        try {
          // first, get the photo
          const photo = await session.camera.requestPhoto();
          console.log(`Photo taken for user ${userId}, timestamp: ${photo.timestamp}`);
          this.debugSavePhoto(photo, userId);

          await this.speakToUser(session, "okay, one sec");
          
          // Analyze the photo with Gemini using current language
          try {
            const translation_response = await analyzeAndTranslateWithGemini(photo.buffer, photo.mimeType, this.currentLanguage);
            let classes = await getObjectsFromRoboflow(photo.buffer);
            // Remove the main translation_response.word from the Roboflow classes if it exists
            const filteredClasses = classes.filter(item => item.toLowerCase() !== translation_response.word.toLowerCase());
            classes = filteredClasses;
            let extra_speech = '';
            if (classes && classes.length > 0) {
                const translations = await Promise.all(
                classes.map(async (item) => {
                  const translation = await translateWithGemini(item, this.currentLanguage);
                  return { original: item, translated: translation.characters, anglicized: translation.anglicized };
                })
                );

                const additionalSpeech = translations
                .map(({ original, translated }) => `${original}, which is ${translated}`)
                .join(', ');

                extra_speech = `I also see ${additionalSpeech}.`;

                // Save each translated word to the API
                for (const { original, translated, anglicized } of translations) {
                const wordEntry: WordEntry = {
                  word: original,
                  translation: translated,
                  anglosax: anglicized,
                  picture: photo.buffer.toString('base64'),
                  timestamp: new Date().toISOString(),
                  language: this.currentLanguage === "Mandarin" ? 'zh' : 'ko',
                  id: Date.now(),
                };

                sendWordToAPI(wordEntry);
              }
            }
            const languageShort = this.currentLanguage;
            const speech = `${translation_response.word} in ${languageShort} is ${translation_response.characters}. ${extra_speech} Do you have any questions?`;
            await this.speakToUser(session, speech);
            this.setListening();

            // Send the word entry to the external API
            const wordEntry: WordEntry = {
              word: translation_response.word,
              translation: translation_response.characters,
              anglosax: translation_response.anglicized,
              picture: photo.buffer.toString('base64'),
              timestamp: new Date().toISOString(),
              language: this.currentLanguage === "Mandarin" ? 'zh' : 'ko',
              id: Date.now(),
            };
            
            this.currentWordData = wordEntry;
            sendWordToAPI(wordEntry);

          } catch (error) {
            this.logger.error(`Error analyzing photo with Gemini: ${error}`);
          }
        } catch (error) {
          this.logger.error(`Error taking photo: ${error}`);
        }
      }
    });
    this.speakToUser(session, "Ready to take pictures!");

    this.addCleanupHandler(cleanup1);
  }

  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    console.log(`Session stopped for user ${userId}, reason: ${reason}`);
  }

  /**
   * Helper function to speak text to the user
   */
  private async speakToUser(session: AppSession, text: string): Promise<void> {
    try {
      console.log(`Speaking to user: ${text}`);
      // set listeningto be in the future so any speaking doesn't get transcribed
      this.listeningUntil = Date.now(); // 1 second buffer
      const elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID || "your_elevenlabs_voice_id";
      const elevenLabsModelId = process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";
      const voiceSettings = {
        stability: 0.7,
        similarity_boost: 0.8,
        style: 0.3,
        speed: 1.0
      };
      // dont await otherwise we will be sad
      session.audio.speak(
        text,
        {
          voice_id: elevenLabsVoiceId,
          model_id: elevenLabsModelId,
          voice_settings: voiceSettings,
          volume: 1.0
        },
        
      );
      console.log(`Spoke to user: ${text}`);
    } catch (error) {
      console.error('Error speaking to user:', error);
    }
  }

  /**
   * Helper function to speak both English and non-English text separately
   */
  private async speakToUserBilingual(session: AppSession, englishText: string, nonEnglishText: string): Promise<void> {
    // this thing has a huge gap in between idk how to get rid of it
    await this.speakToUser(session, englishText);
    await this.speakToUser(session, nonEnglishText);
  }

  /**
   * Cache a photo for display
   */
  private async debugSavePhoto(photo: PhotoData, userId: string) {

    // Save photo to local file
    try {
      const photosDir = path.join(process.cwd(), 'photos');
      if (!fs.existsSync(photosDir)) {
        fs.mkdirSync(photosDir, { recursive: true });
      }

      const extension = photo.mimeType.includes('jpeg') ? 'jpg' : 
                       photo.mimeType.includes('png') ? 'png' : 
                       photo.mimeType.includes('webp') ? 'webp' : 'jpg';
      
      const filename = `photo_${userId}_${Date.now()}.${extension}`;
      const filepath = path.join(photosDir, filename);
      
      fs.writeFileSync(filepath, photo.buffer);
      console.log(`Photo saved to: ${filepath}`);
      
      // Open the file automatically (works on macOS, Linux, Windows)
      const openCommand = process.platform === 'darwin' ? 'open' : 
                         process.platform === 'win32' ? 'start' : 'xdg-open';
      
      exec(`${openCommand} "${filepath}"`, (error) => {
        if (error) {
          this.logger.error(`Error opening photo: ${error}`);
        } else {
          console.log(`Photo opened: ${filepath}`);
        }
      });
      
    } catch (error) {
      this.logger.error(`Error saving photo to file: ${error}`);
    }

    console.log(`Photo cached for user ${userId}, timestamp: ${photo.timestamp}`);
  }

}



// Start the server
// DEV CONSOLE URL: https://console.mentra.glass/
// Get your webhook URL from ngrok (or whatever public URL you have)
const app = new ViewLingo();

app.start().catch(console.error);