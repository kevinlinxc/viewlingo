import dataset
import os
from datetime import datetime

db_path = os.path.join(os.path.dirname(__file__), 'translations.db')
db_url = f'sqlite:///{db_path}'
db = dataset.connect(db_url)

table = db['translations']

# Mandarin translations with Pinyin in "anglosax" column
seed_data = [
    {"word": "hello", "translation": "你好", "anglosax": "Nǐ hǎo", "picture": "base64string1", "timestamp": datetime(2024, 6, 7, 10, 0, 0), "language": "Mandarin"},
    {"word": "world", "translation": "世界", "anglosax": "Shì jiè", "picture": "base64string2", "timestamp": datetime(2024, 6, 7, 10, 5, 0), "language": "Mandarin"},
    {"word": "friend", "translation": "朋友", "anglosax": "Péng yǒu", "picture": "base64string3", "timestamp": datetime(2024, 6, 7, 10, 10, 0), "language": "Mandarin"},
    {"word": "love", "translation": "爱", "anglosax": "Ài", "picture": "base64string4", "timestamp": datetime(2024, 6, 7, 10, 15, 0), "language": "Mandarin"},
    {"word": "peace", "translation": "和平", "anglosax": "Hé píng", "picture": "base64string5", "timestamp": datetime(2024, 6, 7, 10, 20, 0), "language": "Mandarin"},
    {"word": "family", "translation": "家庭", "anglosax": "Jiā tíng", "picture": "base64string6", "timestamp": datetime(2024, 6, 7, 10, 25, 0), "language": "Mandarin"},
    {"word": "food", "translation": "食物", "anglosax": "Shí wù", "picture": "base64string7", "timestamp": datetime(2024, 6, 7, 10, 30, 0), "language": "Mandarin"},
    {"word": "water", "translation": "水", "anglosax": "Shuǐ", "picture": "base64string8", "timestamp": datetime(2024, 6, 7, 10, 35, 0), "language": "Mandarin"},
    {"word": "sun", "translation": "太阳", "anglosax": "Tài yáng", "picture": "base64string9", "timestamp": datetime(2024, 6, 7, 10, 40, 0), "language": "Mandarin"},
    {"word": "moon", "translation": "月亮", "anglosax": "Yuè liàng", "picture": "base64string10", "timestamp": datetime(2024, 6, 7, 10, 45, 0), "language": "Mandarin"},
    {"word": "star", "translation": "星星", "anglosax": "Xīng xīng", "picture": "base64string11", "timestamp": datetime(2024, 6, 7, 10, 50, 0), "language": "Mandarin"},
    {"word": "school", "translation": "学校", "anglosax": "Xué xiào", "picture": "base64string12", "timestamp": datetime(2024, 6, 7, 10, 55, 0), "language": "Mandarin"}
]

for entry in seed_data:
    table.insert(entry)

print("Database seeded with Pinyin in the 'anglosax' column!") 