import { AppServer, AppSession, ViewType, AuthenticatedRequest, PhotoData } from '@mentra/sdk';
import { Request, Response } from 'express';
import * as ejs from 'ejs';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Interface representing a stored photo with metadata
 */
interface StoredPhoto {
  requestId: string;
  buffer: Buffer;
  timestamp: Date;
  userId: string;
  mimeType: string;
  filename: string;
  size: number;
}

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
 * Analyzes an image using the Gemini API
 * @param imageBytes - The image data as a Buffer
 * @param mimeType - The MIME type of the image
 * @returns Promise<string> - The response text from Gemini
 */
async function analyzeImageWithGemini(imageBytes: Buffer, mimeType: string): Promise<string> {
  try {
    console.log("Calling Gemini API to analyze image...");
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const imagePart = {
      inlineData: {
        data: imageBytes.toString('base64'),
        mimeType: mimeType,
      },
    };

    const prompt = "What is the subject of this image? Answer in few words, with no adjectives or grammar, just a noun.";

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();
    
    console.log('Gemini response:', text);
    return text;
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    throw error;
  }
}

/**
 * Translates a word or phrase to Mandarin Chinese using the Gemini API
 * @param wordOrPhrase - The word or phrase to translate
 * @returns Promise<{characters: string, anglicized: string}> - The translation result
 */
async function translateWithGemini(wordOrPhrase: string): Promise<{characters: string, anglicized: string}> {
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const formatPrompt = '{"characters": "", "anglicized": ""}';
    const prompt = `What is \`${wordOrPhrase}\` in Mandarin Chinese? Answer in this JSON format: ${formatPrompt}, with no other formatting or padding`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
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
  private photos: Map<string, StoredPhoto> = new Map(); // Store photos by userId
  private latestPhotoTimestamp: Map<string, number> = new Map(); // Track latest photo timestamp per user
  private isStreamingPhotos: Map<string, boolean> = new Map(); // Track if we are streaming photos for a user
  private nextPhotoTime: Map<string, number> = new Map(); // Track next photo time for a user

  constructor() {
    super({
      packageName: PACKAGE_NAME,
      apiKey: MENTRAOS_API_KEY,
      port: PORT,
    });
    this.setupWebviewRoutes();
  }


  /**
   * Handle new session creation and button press events
   */
  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    // this gets called whenever a user launches the app
    this.logger.info(`Session started for user ${userId}`);

    // set the initial state of the user
    this.isStreamingPhotos.set(userId, false);
    this.nextPhotoTime.set(userId, Date.now());

    // this gets called whenever a user presses a button
    session.events.onButtonPress(async (button) => {
      this.logger.info(`Button pressed: ${button.buttonId}, type: ${button.pressType}`);

      if (button.pressType === 'long') {
        // the user held the button, so we toggle the streaming mode
        this.logger.info("User long pressed, doing nothing");
        return;
      } else {
        this.logger.info(`User short pressed, taking photo`);
        session.layouts.showTextWall("Button pressed, about to take photo", {durationMs: 4000});
        console.log("User short pressed, taking photo");
        // the user pressed the button, so we take a single photo
        try {
          // first, get the photo
          const photo = await session.camera.requestPhoto();
          // if there was an error, log it
          this.logger.info(`Photo taken for user ${userId}, timestamp: ${photo.timestamp}`);
          
          // Analyze the photo with Gemini
          try {
            const word_found = await analyzeImageWithGemini(photo.buffer, photo.mimeType);
            console.log(`Word found in photo from Gemini: ${word_found}`);
            const translation_response = await translateWithGemini(word_found);
            console.log(`Translation response from Gemini: ${JSON.stringify(translation_response)}`);
            session.layouts.showTextWall(`Translation: ${translation_response.characters} (${translation_response.anglicized})`, {durationMs: 5000});
            const response = await session.audio.speak(`${word_found} in Mandarin is ${translation_response.characters}`);

            // Send the word entry to the external API
            const wordEntry: WordEntry = {
              word: word_found,
              translation: translation_response.characters,
              anglosax: translation_response.anglicized,
              picture: photo.buffer.toString('base64'), // Encode photo buffer as base64
              timestamp: new Date().toISOString(),
              language: 'zh',
              id: Date.now() // Use timestamp as a unique ID
            };
            await sendWordToAPI(wordEntry);

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

    // repeatedly check if we are in streaming mode and if we are ready to take another photo
    setInterval(async () => {
      if (this.isStreamingPhotos.get(userId) && Date.now() > (this.nextPhotoTime.get(userId) ?? 0)) {
        try {
          // set the next photos for 30 seconds from now, as a fallback if this fails
          this.nextPhotoTime.set(userId, Date.now() + 30000);

          // actually take the photo
          const photo = await session.camera.requestPhoto();

          // set the next photo time to now, since we are ready to take another photo
          this.nextPhotoTime.set(userId, Date.now());

          // cache the photo for display
          this.debugSavePhoto(photo, userId);
        } catch (error) {
          this.logger.error(`Error auto-taking photo: ${error}`);
        }
      }
    }, 1000);
  }

  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    // clean up the user's state
    this.isStreamingPhotos.set(userId, false);
    this.nextPhotoTime.delete(userId);
    this.logger.info(`Session stopped for user ${userId}, reason: ${reason}`);
  }

  /**
   * Cache a photo for display
   */
  private async debugSavePhoto(photo: PhotoData, userId: string) {
    // create a new stored photo object which includes the photo data and the user id
    const cachedPhoto: StoredPhoto = {
      requestId: photo.requestId,
      buffer: photo.buffer,
      timestamp: photo.timestamp,
      userId: userId,
      mimeType: photo.mimeType,
      filename: photo.filename,
      size: photo.size
    };

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
      this.logger.info(`Photo saved to: ${filepath}`);
      
      // Open the file automatically (works on macOS, Linux, Windows)
      const openCommand = process.platform === 'darwin' ? 'open' : 
                         process.platform === 'win32' ? 'start' : 'xdg-open';
      
      exec(`${openCommand} "${filepath}"`, (error) => {
        if (error) {
          this.logger.error(`Error opening photo: ${error}`);
        } else {
          this.logger.info(`Photo opened: ${filepath}`);
        }
      });
      
    } catch (error) {
      this.logger.error(`Error saving photo to file: ${error}`);
    }

    this.logger.info(`Photo cached for user ${userId}, timestamp: ${cachedPhoto.timestamp}`);
  }


  /**
 * Set up webview routes for photo display functionality
 */
  private setupWebviewRoutes(): void {
    const app = this.getExpressApp();

    // API endpoint to get the latest photo for the authenticated user
    app.get('/api/latest-photo', (req: any, res: any) => {
      const userId = (req as AuthenticatedRequest).authUserId;

      if (!userId) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const photo = this.photos.get(userId);
      if (!photo) {
        res.status(404).json({ error: 'No photo available' });
        return;
      }

      res.json({
        requestId: photo.requestId,
        timestamp: photo.timestamp.getTime(),
        hasPhoto: true
      });
    });

    // API endpoint to get photo data
    app.get('/api/photo/:requestId', (req: any, res: any) => {
      const userId = (req as AuthenticatedRequest).authUserId;
      const requestId = req.params.requestId;

      if (!userId) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const photo = this.photos.get(userId);
      if (!photo || photo.requestId !== requestId) {
        res.status(404).json({ error: 'Photo not found' });
        return;
      }

      res.set({
        'Content-Type': photo.mimeType,
        'Cache-Control': 'no-cache'
      });
      res.send(photo.buffer);
    });

    // Main webview route - displays the photo viewer interface
    app.get('/webview', async (req: any, res: any) => {
      const userId = (req as AuthenticatedRequest).authUserId;

      if (!userId) {
        res.status(401).send(`
          <html>
            <head><title>Photo Viewer - Not Authenticated</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
              <h1>Please open this page from the MentraOS app</h1>
            </body>
          </html>
        `);
        return;
      }

      const templatePath = path.join(process.cwd(), 'views', 'photo-viewer.ejs');
      const html = await ejs.renderFile(templatePath, {});
      res.send(html);
    });
  }
}



// Start the server
// DEV CONSOLE URL: https://console.mentra.glass/
// Get your webhook URL from ngrok (or whatever public URL you have)
const app = new ViewLingo();

app.start().catch(console.error);