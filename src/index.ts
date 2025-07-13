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
  englishword: string;
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
async function analyzeAndTranslateWithGemini(imageBytes: Buffer, mimeType: string, language: string = "Mandarin Chinese"): Promise<{englishword: string, characters: string, anglicized: string}> {
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

    const formatPrompt = '{"englishword": "", "characters": "", "anglicized": ""}';
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
 * Queries the Gemini API with a given prompt
 * @param prompt - The prompt to send to the Gemini API
 * @returns Promise<string> - The response from the Gemini API
 */
async function queryGemini(prompt: string): Promise<string> {
  try {
    console.log(`Querying Gemini API with prompt: ${prompt}`);
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent([prompt]);
    const response = await result.response;
    const text = response.text();

    console.log('Gemini response:', text);
    return text.trim();
  } catch (error) {
    console.error('Error querying Gemini API:', error);
    throw error;
  }
}


/**
 * Photo Taker App with webview functionality for displaying photos
 * Extends AppServer to provide photo taking and webview display capabilities
 */
class ViewLingo extends AppServer {
  private currentWordData: WordEntry | null = null;

  constructor() {
    super({
      packageName: PACKAGE_NAME,
      apiKey: MENTRAOS_API_KEY,
      port: PORT,
    });
  }


  /**
   * Handle new session creation and button press events
   */
  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    // this gets called whenever a user launches the app
    console.log(`Session started for user ${userId}`);
    session.audio.speak("Ready!")

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
        session.audio.speak("Taking photo, hold still");
        // the user pressed the button, so we take a single photo
        try {
          // first, get the photo
          const photo = await session.camera.requestPhoto();
          session.audio.speak("Photo taken.");
          // if there was an error, log it
          console.log(`Photo taken for user ${userId}, timestamp: ${photo.timestamp}`);
          
          // Analyze the photo with Gemini
          try {
            // console.log(`Translation response from Gemini: ${JSON.stringify(translation_response)}`);
            const translation_response = await analyzeAndTranslateWithGemini(photo.buffer, photo.mimeType);
            session.layouts.showTextWall(`Translation: ${translation_response.characters} (${translation_response.anglicized})`, {durationMs: 5000});
            const speak = `${translation_response.englishword} in Mandarin is ${translation_response.characters}`;
            console.log(`Speaking ${speak}`)
            const response = await session.audio.speak(speak);

            // Send the word entry to the external API
            const wordEntry: WordEntry = {
              englishword: translation_response.englishword,
              translation: translation_response.characters,
              anglosax: translation_response.anglicized,
              picture: photo.buffer.toString('base64'), // Encode photo buffer as base64
              timestamp: new Date().toISOString(),
              language: 'zh',
              id: Date.now() // Use timestamp as a unique ID
            };
            await sendWordToAPI(wordEntry);

            // set current word entry 
            this.currentWordData = wordEntry;

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

    // session.events.onTranscription((data) => {
    //   // this gets called whenever the user speaks
    //   console.log(`Transcription received: ${data.text}`);
    //   session.layouts.showTextWall(data.text, {durationMs: 5000});

    //   // if the user said "take photo", we take a photo
    //   const lowercase = data.text.toLowerCase();
    //   if (lowercase.includes("what's this") || lowercase.includes("what is this") || lowercase.includes("how do I say")) {
    //     session.layouts.showTextWall("Taking photo...", {durationMs: 2000});
    //     session.camera.requestPhoto().then(photo => {
    //       this.debugSavePhoto(photo, userId);
    //     }).catch(error => {
    //       this.logger.error(`Error taking photo: ${error}`);
    //     });
    //   }
    // });
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