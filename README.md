# Viewlingo

Smart-glasses-augmented language learning.

Features:
1. See something, snap a picture of it, and the translation of the detected object will be told to you in your ear. You can then start a conversation with an LLM, asking followup questions
2. Translations you learn throughout the day are saved to intuitive flash cards with pronunciation
3. You can take quizzes for words you learned througout the day
4. You can chat with an AI about how you did on the quiz and what you can do to improve
5. You can speak to a voice agent to practice the words you learned in a day


## Frontend

Frontend PWA/webapp repo - github.com/mslee300/viewlingo-frontend

## How to run
To run:


1. Set up a .env file with these fields:
```

PORT=3000
PACKAGE_NAME=< App package name on Mentra dashboard e.g. com.example.app>
MENTRAOS_API_KEY= <also from Mentra dashboard>
GEMINI_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
ELEVENLABS_MODEL_ID=eleven_multilingual_v2

```

Make another .env file in /db with this field (figure out how to generate your own API key/hash):
```
API_TOKEN_HASH=
```

Should probably just make these one .env and move the API Dockerfile out but oh well

2.Run the typescript backend + python api/db with Docker:

```bash
docker compose up --build
```

3. Get a free dedicated url from ngrok, set it up locally (same computer as Docker) and run:

```
ngrok http --url=<your ngrok url> 7777
```

Anyone who hits the URL hits port 7777, which hits your local 7777, which hits nginx, which hits the typescript backend or the DB/FastAPI, depending on the url. 
