from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import dataset
import os
from typing import List, Optional
from datetime import datetime

app = FastAPI()

# Allow all origins for development/testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to specific origins in production
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

@app.get('/words', response_model=List[WordEntry], response_class=JSONResponse)
def get_words():
    table = db['translations']
    words = list(table.all())
    for w in words:
        if isinstance(w.get('timestamp'), datetime):
            w['timestamp'] = w['timestamp'].isoformat()
    return JSONResponse(content=words)

@app.post('/words', response_class=JSONResponse)
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
    words = list(table.find(timestamp={"between": [day_start, day_end]}))
    for w in words:
        if isinstance(w.get('timestamp'), datetime):
            w['timestamp'] = w['timestamp'].isoformat()
    return JSONResponse(content=words)

# @app.get('/translate/')