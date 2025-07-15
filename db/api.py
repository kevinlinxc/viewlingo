from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import dataset
import os
from typing import List, Optional
from datetime import datetime, timedelta

app = FastAPI(root_path="/api", docs_url="/docs")

# Allow only localhost:3000 and viewlingo.vercel.app
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        # "http://localhost:3000",
        # "https://viewlingo.vercel.app"
        "*"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db_path = os.path.join(os.path.dirname(__file__), 'translations.db')
db_url = f'sqlite:///{db_path}'
db = dataset.connect(db_url)


class WordEntry(BaseModel):
    word: str
    translation: str
    anglosax: Optional[str] = None
    picture: Optional[str] = None  # base64 string
    timestamp: Optional[datetime] = None
    language: Optional[str] = None
    id: Optional[int] = None

class LocationEntry(BaseModel):
    name: str
    translated_name: str
    translated_name_anglicized: str # Assuming this is the same for now
    id: Optional[int] = None



@app.get('/words', response_model=List[WordEntry], response_class=JSONResponse)
def get_words():
    table = db['translations']
    words = list(table.all())
    for w in words:
        if isinstance(w.get('timestamp'), datetime):
            w['timestamp'] = w['timestamp'].isoformat()
    return JSONResponse(content=words)


@app.post("/words", response_class=JSONResponse)
def add_word(entry: WordEntry):
    table = db['translations']
    ts = entry.timestamp or datetime.utcnow()
    data = {
        'word': entry.word,
        'translation': entry.translation,
        'anglosax': entry.anglosax,
        'picture': entry.picture,
        'timestamp': ts,
        'language': entry.language
    }
    inserted = table.insert(data)
    return JSONResponse(content={"success": True, "id": inserted})

@app.get('/words/full', response_model=List[WordEntry], response_class=JSONResponse)
def get_words_of_the_day(date: str = Query(..., description="Date in YYYY-MM-DD format")):
    table = db['translations']
    try:
        day_start = datetime.strptime(date, "%Y-%m-%d")
        day_end = day_start.replace(hour=23, minute=59, second=59, microsecond=999999)
    except ValueError:
        return JSONResponse(status_code=400, content={"detail": "Invalid date format. Use YYYY-MM-DD."})
    # Get the latest 8 rows for the given date, ordered by timestamp descending
    words = list(table.find(timestamp={"between": [day_start, day_end]}, order_by='-timestamp', _limit=8))
    for w in words:
        if isinstance(w.get('timestamp'), datetime):
            w['timestamp'] = w['timestamp'].isoformat()
    return JSONResponse(content=words)

# New endpoint: get all words from today (UTC), excluding the 'picture' column
@app.get('/words/of-the-day', response_class=JSONResponse)
def get_words_today():
    table = db['translations']
    now = datetime.utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = now.replace(hour=23, minute=59, second=59, microsecond=999999)
    words = list(table.find(timestamp={"between": [day_start, day_end]}))
    filtered_words = []
    for w in words:
        w.pop('picture', None)
        w.pop('translation', None)
        if isinstance(w.get('timestamp'), datetime):
            w['timestamp'] = w['timestamp'].isoformat()
        filtered_words.append({
            'word': w.get('word'),
            'anglosax': w.get('anglosax'),
            'timestamp': w.get('timestamp'),
            'language': w.get('language'),
            'id': w.get('id')
        })
    return JSONResponse(content=filtered_words)

@app.get('/words/by-language', response_class=JSONResponse)
def get_words_by_language(
    language: str = Query(..., description="Language code to filter words (e.g., 'zh', 'es', etc.)"),
    date: str = Query(..., description="Date in YYYY-MM-DD format")
):
    table = db['translations']
    try:
        day_start = datetime.strptime(date, "%Y-%m-%d")
        day_end = day_start.replace(hour=23, minute=59, second=59, microsecond=999999)
    except ValueError:
        return JSONResponse(status_code=400, content={"detail": "Invalid date format. Use YYYY-MM-DD."})
    words = list(table.find(timestamp={"between": [day_start, day_end]}, language=language, order_by='-timestamp', _limit=8))
    filtered_words = []
    for w in words:
        if isinstance(w.get('timestamp'), datetime):
            w['timestamp'] = w['timestamp'].isoformat()
        filtered_words.append({
            'word': w.get('word'),
            'anglosax': w.get('anglosax'),
            'translation': w.get('translation'),
            'picture': w.get('picture'),
            'timestamp': w.get('timestamp'),
            'language': w.get('language'),
            'id': w.get('id')
        })
    return JSONResponse(content=filtered_words)

@app.post('/locations', response_class=JSONResponse)
def add_location(location: LocationEntry):
    table = db['locations']
    if not location.name or not location.translated_name:
        return JSONResponse(status_code=400, content={"detail": "Name and translated name cannot be empty."})
    
    # Check if location already exists
    existing = table.find_one(name=location.name)
    if existing:
        return JSONResponse(status_code=202, content={"detail": "Location already exists."})
    
    data = {
        'name': location.name,
        'translated_name': location.translated_name,
        'translated_name_anglicized': location.translated_name_anglicized,
    }
    inserted = table.insert(data)
    return JSONResponse(content={"success": True, "id": inserted})

@app.get('/locations', response_model=List[LocationEntry], response_class=JSONResponse)
def get_locations():
    table = db['locations']
    locations = list(table.all())
    return JSONResponse(content=locations)