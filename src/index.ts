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
async function analyzeAndTranslateWithGemini(imageBytes: Buffer, mimeType: string, language: string = "Mandarin Chinese"): Promise<{word: string, characters: string, anglicized: string}> {
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
    const prompt = `Analyze the subject of this image (just one subject, in minimum number of words, no adjectives or punctuation) and translate it to ${language}. Answer in this JSON format: ${formatPrompt}, with no other formatting, backticks, or padding.`;
    
    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();

    console.log('Gemini combined response:', text);

    // Parse the JSON response
    const analysisAndTranslation = JSON.parse(text.trim());
    return analysisAndTranslation;
  } catch (error) {
    console.error('Error analyzing and translating with Gemini API:', error);
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
    const response = await fetch(`${API_ENDPOINT}/words`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify(wordData)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Word successfully sent to API:', result);
  } catch (error) {
    console.error('Error sending word to API:', error);
    throw error;
  }
}




/**
 * Photo Taker App with webview functionality for displaying photos
 * Extends AppServer to provide photo taking and webview display capabilities
 */
class ViewLingo extends AppServer {
  private currentWordData: WordEntry | null = null;
  private listeningUntil: number = 0; // Timestamp when listening expires
  private readonly LISTENING_DURATION_MS = 10000; // 10 seconds
  private customPrompt: string = "You are a language learning assistant. The user just learned about this word: {word} ({translation} - {anglicized}). Please respond helpfully to their question or comment about this word. Keep responses brief and educational.";

  constructor() {
    super({
      packageName: PACKAGE_NAME,
      apiKey: MENTRAOS_API_KEY,
      port: PORT,
    });
  }

  /**
   * Set custom prompt for Gemini interactions
   */
  setCustomPrompt(prompt: string): void {
    this.customPrompt = prompt;
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
    await session.audio.speak("Ready!")

    // set the initial state of the user

    // this gets called whenever a user presses a button
    session.events.onButtonPress(async (button) => {
      console.log(`Button pressed: ${button.buttonId}, type: ${button.pressType}`);

      if (button.pressType === 'long') {
        // the user held the button, so we toggle the streaming mode
        console.log("User long pressed, doing nothing");
        return;
      } else {
        console.log(`User short pressed, taking photo`);
        await session.audio.speak("Hold still, taking photo");
        // the user pressed the button, so we take a single photo
        try {
          // first, get the photo
          const photo = await session.camera.requestPhoto();
          // if there was an error, log it
          console.log(`Photo taken for user ${userId}, timestamp: ${photo.timestamp}`);
          
          // Analyze the photo with Gemini
          try {
            // console.log(`Translation response from Gemini: ${JSON.stringify(translation_response)}`);
            const translation_response = await analyzeAndTranslateWithGemini(photo.buffer, photo.mimeType);
            session.layouts.showTextWall(`Translation: ${translation_response.characters} (${translation_response.anglicized})`, {durationMs: 5000});
            const speak = `${translation_response.word} in Mandarin is ${translation_response.characters}`;
            console.log(`Speaking ${speak}`)
            const elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID || "your_elevenlabs_voice_id";
            const elevenLabsModelId = process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";
            const voiceSettings = {
              stability: 0.7,
              similarity_boost: 0.8,
              style: 0.3,
              speed: 0.9
            };
            const response = await session.audio.speak(
              speak,
              {
                voice_id: elevenLabsVoiceId,
                model_id: elevenLabsModelId,
                voice_settings: voiceSettings
              }
            );

            // Send the word entry to the external API
            const wordEntry: WordEntry = {
              word: translation_response.word,
              translation: translation_response.characters,
              anglosax: translation_response.anglicized,
              picture: photo.buffer.toString('base64'), // Encode photo buffer as base64
              timestamp: new Date().toISOString(),
              language: 'zh',
              id: Date.now() // Use timestamp as a unique ID
            };
            
            // Store current word data for context
            this.currentWordData = wordEntry;
            
            await sendWordToAPI(wordEntry);
            this.setListening();

          } catch (error) {
            this.logger.error(`Error analyzing photo with Gemini: ${error}`);
            session.layouts.showTextWall("Error analyzing photo", {durationMs: 3000});
          }
          
          // Cache the photo (this will save it to file and open it)
          this.debugSavePhoto(photo, userId);
        } catch (error) {
          this.logger.error(`Error taking photo: ${error}`);
        }
      }
    });

    session.events.onTranscription(async (data) => {
      // Only process final transcriptions when listening
      if (this.isListening() && data.isFinal) {
        console.log(`Transcription received: ${data.text}`);
        this.setListening(); // Reset listening timer
        
        try {
          // Send transcription to Gemini with current word context
          const geminiResponse = await this.sendPromptToGemini(data.text);
          console.log(`Gemini response: ${geminiResponse}`);
          
          // Display and speak the response
          session.layouts.showTextWall(geminiResponse, {durationMs: 5000});
          await session.audio.speak(geminiResponse);
          
        } catch (error) {
          console.error('Error processing transcription with Gemini:', error);
          session.layouts.showTextWall("Sorry, I didn't understand that", {durationMs: 3000});
        }
      }
    });
  }

  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    // clean up the user's state
    console.log(`Session stopped for user ${userId}, reason: ${reason}`);
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